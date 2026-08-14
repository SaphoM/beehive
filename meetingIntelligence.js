// ============================================================
// meetingIntelligence.js
// Job-runner for the opt-in Meeting Intelligence pipeline (recording →
// transcription → LLM summary). Imported into livekit_node_backend.js.
// See the "Enterprise Meeting Intelligence Bot" plan for full context.
// ============================================================
// This is the DB-backed "queue" this deployment needs in place of a real
// message broker (single Render web dyno, no Redis, no worker process —
// see the plan's Context section for why). Each stage checks its own
// output column before redoing work, so retrying an already-partially-done
// job (via the periodic sweep, or a second setImmediate dispatch racing an
// earlier one) is always safe, not merely "probably fine."
//
// Deliberately designed so a real queue (BullMQ/SQS/etc.) could replace the
// setImmediate + sweep dispatch mechanism later without this module or the
// job table's shape changing at all: runJob(jobId) takes only an id and
// re-derives everything else from the DB row, exactly like a worker
// consuming a queue message would.

import { EncodedFileOutput, EncodedFileType, S3Upload } from '@livekit/protocol'
import { createTranscriptionProvider } from './providers/transcription.js'
import { createLLMProvider } from './providers/llm.js'

const BUCKET = 'meeting-intelligence'
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STUCK_THRESHOLD_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

// Statuses the sweep is allowed to retry. 'recording' is deliberately
// excluded — a job stuck there for >10min most likely means the meeting is
// still genuinely in progress (a long call), not a failure; auto-retrying
// it would be wrong. Only post-egress stages, where "stuck" unambiguously
// means our own processing stalled, are eligible. 'transcribing'/
// 'summarizing' are included so a job doesn't stay stuck forever if the
// process crashes/restarts mid-claim (see reclaimStuckJob below) — every
// other status here is a stable rest state a job can safely sit in
// indefinitely; these two are the only "someone is actively working on
// this" states, so being stuck there past the threshold always means the
// worker died, never that work is legitimately still in progress.
const SWEEPABLE_STATUSES = ['egress_done', 'transcribed', 'skipped_no_provider', 'transcribing', 'summarizing']

// ------------------------------------------------------------
// createMeetingIntelligence — factory taking the already-instantiated
// service-role Supabase client and LiveKit EgressClient from the backend,
// rather than constructing its own — avoids a second, potentially
// drifting set of credentials/client instances for the same resources.
// ------------------------------------------------------------
export function createMeetingIntelligence({ supabase, egressClient }) {
  // ------------------------------------------------------------
  // startMeetingEgress — called from the room_started webhook branch.
  // jobId must already exist (the webhook handler inserts the job row
  // first, then calls this, then patches the row with the returned
  // egressId) so the audio's storage path can be derived deterministically
  // from it — this sidesteps ever needing to parse/trust the egress_ended
  // webhook's own `file.filename`/`file.location` fields, which turned out
  // (see the pre-existing egress_ended branch) to already be misread
  // elsewhere in this file due to a snake_case/camelCase mismatch. Storing
  // the path we ourselves chose, up front, keeps this new pipeline's
  // correctness independent of that.
  // ------------------------------------------------------------
  async function startMeetingEgress(roomId, livekitRoomName, jobId) {
    const storagePath = `${roomId}/${jobId}.ogg`

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: storagePath,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: process.env.SUPABASE_S3_ACCESS_KEY_ID,
          secret: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
          region: process.env.SUPABASE_S3_REGION,
          endpoint: process.env.SUPABASE_S3_ENDPOINT,
          bucket: BUCKET,
          forcePathStyle: true,
        }),
      },
    })

    const egressInfo = await egressClient.startRoomCompositeEgress(livekitRoomName, output, { audioOnly: true })
    return { egressId: egressInfo.egressId, storagePath }
  }

  // ------------------------------------------------------------
  // Stage helpers — each one is a no-op if its own output already exists,
  // which is what makes runJob() safe to call more than once for the same
  // job (retry-from-sweep, or a rare double-dispatch race).
  // ------------------------------------------------------------

  async function downloadAudio(storagePath) {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
    if (error || !data) throw new Error(`Failed to download meeting audio: ${error?.message ?? 'no data'}`)
    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  // ------------------------------------------------------------
  // claimStage — the concurrency guard. Atomically flips a job's status
  // from `fromStatus` to `toStatus` (an ordinary conditional UPDATE, so
  // Postgres's own row-level locking makes exactly one caller win under
  // concurrency) and returns the claimed row, or `null` if the job wasn't
  // in `fromStatus` when this ran — meaning a concurrent runJob() (two
  // egress_ended deliveries for the same egress, a sweep pass racing a
  // fresh dispatch, etc.) already claimed it. The caller must bail out on
  // `null` rather than proceed, which is what makes double-webhook-delivery
  // produce exactly one transcript/summary instead of duplicates.
  // ------------------------------------------------------------
  async function claimStage(jobId, fromStatus, toStatus) {
    const { data, error } = await supabase
      .from('meeting_intelligence_jobs')
      .update({ status: toStatus, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', fromStatus)
      .select()
      .maybeSingle()
    if (error) throw new Error(`Failed to claim job stage (${fromStatus} → ${toStatus}): ${error.message}`)
    return data
  }

  async function runTranscriptionStage(jobId, fromStatus) {
    const provider = createTranscriptionProvider()
    if (!provider) {
      await markStatus(jobId, 'skipped_no_provider')
      return
    }

    const claimed = await claimStage(jobId, fromStatus, 'transcribing')
    if (!claimed) return // lost the race to a concurrent runner — no-op, not an error

    try {
      const audioBuffer = await downloadAudio(claimed.audio_storage_path)
      const { text, segments } = await provider.transcribe(audioBuffer, { mimeType: 'audio/ogg' })

      const { data: transcript, error: insertError } = await supabase
        .from('meeting_transcripts')
        .insert({ room_id: claimed.room_id, job_id: claimed.id, provider: provider.name, full_text: text, segments })
        .select('id')
        .single()
      if (insertError || !transcript) throw new Error(`Failed to store transcript: ${insertError?.message}`)

      await supabase.from('meeting_intelligence_jobs')
        .update({ transcript_id: transcript.id, status: 'transcribed', updated_at: new Date().toISOString(), attempts: 0, last_error: null })
        .eq('id', jobId)
    } catch (e) {
      // Revert to the pre-claim status (not straight to 'failed') so the
      // sweep resumes this exact stage on the next pass, up to MAX_ATTEMPTS.
      await recordFailure(claimed, fromStatus, e)
      throw e
    }
  }

  async function runSummaryStage(jobId, fromStatus) {
    const provider = createLLMProvider()
    if (!provider) {
      await markStatus(jobId, 'skipped_no_provider')
      return
    }

    const claimed = await claimStage(jobId, fromStatus, 'summarizing')
    if (!claimed) return // lost the race to a concurrent runner — no-op, not an error

    try {
      const { data: transcript, error: fetchError } = await supabase
        .from('meeting_transcripts')
        .select('full_text')
        .eq('id', claimed.transcript_id)
        .single()
      if (fetchError || !transcript) throw new Error(`Failed to load transcript for summary: ${fetchError?.message}`)

      const { summaryMarkdown, actionItems } = await provider.generate(transcript.full_text)

      const { error: insertError } = await supabase
        .from('meeting_intelligence')
        .insert({ room_id: claimed.room_id, job_id: claimed.id, provider: provider.name, summary_markdown: summaryMarkdown, action_items: actionItems })
      if (insertError) throw new Error(`Failed to store meeting intelligence: ${insertError.message}`)

      await supabase.from('meeting_intelligence_jobs')
        .update({ status: 'complete', updated_at: new Date().toISOString(), attempts: 0, last_error: null })
        .eq('id', jobId)
    } catch (e) {
      await recordFailure(claimed, fromStatus, e)
      throw e
    }
  }

  // Supabase-js never throws for a failed query — a failed write resolves
  // normally with `{ data: null, error: {...} }`, not a rejected promise.
  // Both status-writing helpers below explicitly check that field and log
  // on failure; without this, a transient write failure here would leave a
  // job silently stuck with no trace anywhere of why, exactly the class of
  // silent failure this pipeline is required not to have.
  async function markStatus(jobId, status) {
    const { error } = await supabase.from('meeting_intelligence_jobs')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', jobId)
    if (error) console.error('[intelligence] markStatus write failed:', jobId, status, error.message)
  }

  async function recordFailure(job, stageStatus, error) {
    const attempts = (job.attempts ?? 0) + 1
    const nextStatus = attempts >= MAX_ATTEMPTS ? 'failed' : stageStatus
    const { error: writeError } = await supabase.from('meeting_intelligence_jobs')
      .update({ status: nextStatus, attempts, last_error: String(error?.message ?? error).slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('id', job.id)
    if (writeError) console.error('[intelligence] recordFailure write failed:', job.id, writeError.message, '— original error was:', error?.message ?? error)
  }

  // ------------------------------------------------------------
  // reclaimStuckJob — called by the sweep for a job found sitting in
  // 'transcribing'/'summarizing' past the stuck threshold. Those two
  // statuses only ever exist between claimStage() and the stage's own
  // completion/failure handling a moment later — sitting there for 10+
  // minutes means the process died mid-stage (deploy, crash, OOM) and
  // never got to revert it itself. Reverts to the correct pre-claim status
  // (bumping attempts/last_error the same way a normal failure would) so
  // the job becomes eligible for a normal claim-and-retry again.
  // ------------------------------------------------------------
  async function reclaimStuckJob(job) {
    const revertTo = job.status === 'transcribing' ? 'egress_done' : 'transcribed'
    await recordFailure(job, revertTo, new Error(`Reclaimed: stuck in '${job.status}' past the stuck threshold (worker likely died mid-stage)`))
  }

  // ------------------------------------------------------------
  // runJob — the entire pipeline for one job, driven purely by its current
  // status. Never throws outward: every failure is caught, recorded on the
  // job row, and left for the sweep to retry (or mark failed past
  // MAX_ATTEMPTS) — this function is always called fire-and-forget
  // (setImmediate) specifically so a bug here can never propagate back into
  // the webhook response path or, transitively, the meeting itself.
  // ------------------------------------------------------------
  async function runJob(jobId) {
    const { data: job, error } = await supabase.from('meeting_intelligence_jobs').select('*').eq('id', jobId).single()
    if (error || !job) return

    // Each branch below passes the exact status it observed as `fromStatus`
    // into the stage function's own claimStage() call — if a concurrent
    // runJob() (a second webhook delivery, an overlapping sweep tick) has
    // already moved the job off that status by the time the claim runs,
    // claimStage() atomically fails to match and the stage function
    // no-ops. This is what makes runJob() itself safe to call more than
    // once concurrently for the same job — the actual duplicate-work guard
    // lives in claimStage(), not here; this function just decides which
    // stage to attempt based on a snapshot that may already be stale by
    // the time the attempt lands, and that's fine.
    try {
      if (job.status === 'egress_done') {
        await runTranscriptionStage(jobId, 'egress_done')
        // Re-fetch: runTranscriptionStage may have just flipped this to
        // 'transcribed' or 'skipped_no_provider' — chain straight into the
        // summary stage in the same pass rather than waiting for the next
        // sweep cycle, when transcription succeeded.
        const { data: updated } = await supabase.from('meeting_intelligence_jobs').select('*').eq('id', jobId).single()
        if (updated?.status === 'transcribed') await runSummaryStage(jobId, 'transcribed')
        return
      }
      if (job.status === 'transcribed') {
        await runSummaryStage(jobId, 'transcribed')
        return
      }
      if (job.status === 'skipped_no_provider') {
        // An operator may have configured a provider since this job last
        // ran — re-check from whichever stage is actually still missing.
        if (!job.transcript_id) {
          await runTranscriptionStage(jobId, 'skipped_no_provider')
          const { data: updated } = await supabase.from('meeting_intelligence_jobs').select('*').eq('id', jobId).single()
          if (updated?.status === 'transcribed') await runSummaryStage(jobId, 'transcribed')
        } else {
          await runSummaryStage(jobId, 'skipped_no_provider')
        }
        return
      }
      // 'recording', 'transcribing', 'summarizing', 'complete', 'failed':
      // nothing for a fresh dispatch to do — 'transcribing'/'summarizing'
      // mean another runJob() call already has this job claimed; only the
      // sweep's reclaimStuckJob() (below) is allowed to touch those, and
      // only past the stuck threshold.
    } catch (e) {
      // The stage functions already record their own failure on the job row
      // (reverting to their fromStatus) before rethrowing — but this outer
      // catch can also be reached by a failure that never made it into a
      // stage function at all (e.g. the re-fetch .select() calls above,
      // between stages). Never swallow silently: log it even though there's
      // no single job-row write that unambiguously belongs to it here.
      console.error('[intelligence] runJob failed outside a stage handler:', jobId, e?.message)
    }
  }

  // ------------------------------------------------------------
  // startIntelligenceSweep — the retry mechanism. Started once at server
  // boot (see livekit_node_backend.js's app.listen callback).
  // ------------------------------------------------------------
  function startIntelligenceSweep() {
    setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
        // Select full rows (not just id) — reclaimStuckJob needs .status to
        // decide which pre-claim state to revert to.
        const { data: stuck } = await supabase
          .from('meeting_intelligence_jobs')
          .select('*')
          .in('status', SWEEPABLE_STATUSES)
          .lt('updated_at', cutoff)
          .lt('attempts', MAX_ATTEMPTS)
        for (const row of stuck ?? []) {
          if (row.status === 'transcribing' || row.status === 'summarizing') {
            setImmediate(() => reclaimStuckJob(row).catch(e => console.error('[intelligence] sweep reclaim failed:', row.id, e?.message)))
          } else {
            setImmediate(() => runJob(row.id).catch(e => console.error('[intelligence] sweep runJob failed:', row.id, e?.message)))
          }
        }
      } catch (e) {
        console.error('[intelligence] sweep query failed:', e?.message)
      }
    }, SWEEP_INTERVAL_MS)
  }

  return { startMeetingEgress, runJob, startIntelligenceSweep }
}
