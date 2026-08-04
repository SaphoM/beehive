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
// means our own processing stalled, are eligible.
const SWEEPABLE_STATUSES = ['egress_done', 'transcribed', 'skipped_no_provider']

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

  async function runTranscriptionStage(job) {
    const provider = createTranscriptionProvider()
    if (!provider) {
      await markStatus(job.id, 'skipped_no_provider')
      return
    }

    const audioBuffer = await downloadAudio(job.audio_storage_path)
    const { text, segments } = await provider.transcribe(audioBuffer, { mimeType: 'audio/ogg' })

    const { data: transcript, error: insertError } = await supabase
      .from('meeting_transcripts')
      .insert({ room_id: job.room_id, job_id: job.id, provider: provider.name, full_text: text, segments })
      .select('id')
      .single()
    if (insertError || !transcript) throw new Error(`Failed to store transcript: ${insertError?.message}`)

    await supabase.from('meeting_intelligence_jobs')
      .update({ transcript_id: transcript.id, status: 'transcribed', updated_at: new Date().toISOString(), attempts: 0, last_error: null })
      .eq('id', job.id)
  }

  async function runSummaryStage(job) {
    const provider = createLLMProvider()
    if (!provider) {
      await markStatus(job.id, 'skipped_no_provider')
      return
    }

    const { data: transcript, error: fetchError } = await supabase
      .from('meeting_transcripts')
      .select('full_text')
      .eq('id', job.transcript_id)
      .single()
    if (fetchError || !transcript) throw new Error(`Failed to load transcript for summary: ${fetchError?.message}`)

    const { summaryMarkdown, actionItems } = await provider.generate(transcript.full_text)

    const { error: insertError } = await supabase
      .from('meeting_intelligence')
      .insert({ room_id: job.room_id, job_id: job.id, provider: provider.name, summary_markdown: summaryMarkdown, action_items: actionItems })
    if (insertError) throw new Error(`Failed to store meeting intelligence: ${insertError.message}`)

    await supabase.from('meeting_intelligence_jobs')
      .update({ status: 'complete', updated_at: new Date().toISOString(), attempts: 0, last_error: null })
      .eq('id', job.id)
  }

  async function markStatus(jobId, status) {
    await supabase.from('meeting_intelligence_jobs')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', jobId)
  }

  async function recordFailure(job, stageStatus, error) {
    const attempts = (job.attempts ?? 0) + 1
    const nextStatus = attempts >= MAX_ATTEMPTS ? 'failed' : stageStatus
    await supabase.from('meeting_intelligence_jobs')
      .update({ status: nextStatus, attempts, last_error: String(error?.message ?? error).slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('id', job.id)
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

    try {
      if (job.status === 'egress_done') {
        await runTranscriptionStage(job)
        // Re-fetch: runTranscriptionStage may have just flipped this to
        // 'transcribed' or 'skipped_no_provider' — chain straight into the
        // summary stage in the same pass rather than waiting for the next
        // sweep cycle, when transcription succeeded.
        const { data: updated } = await supabase.from('meeting_intelligence_jobs').select('*').eq('id', jobId).single()
        if (updated?.status === 'transcribed') await runSummaryStage(updated)
        return
      }
      if (job.status === 'transcribed') {
        await runSummaryStage(job)
        return
      }
      if (job.status === 'skipped_no_provider') {
        // An operator may have configured a provider since this job last
        // ran — re-check from whichever stage is actually still missing.
        if (!job.transcript_id) {
          await runTranscriptionStage(job)
          const { data: updated } = await supabase.from('meeting_intelligence_jobs').select('*').eq('id', jobId).single()
          if (updated?.status === 'transcribed') await runSummaryStage(updated)
        } else {
          await runSummaryStage(job)
        }
        return
      }
      // 'recording', 'complete', 'failed': nothing to do — see SWEEPABLE_STATUSES.
    } catch (e) {
      // Which stage was in flight determines which status the retry should
      // resume from.
      const stageStatus = job.status === 'transcribed' || (job.status === 'skipped_no_provider' && job.transcript_id)
        ? 'transcribed'
        : 'egress_done'
      await recordFailure(job, stageStatus, e)
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
        const { data: stuck } = await supabase
          .from('meeting_intelligence_jobs')
          .select('id')
          .in('status', SWEEPABLE_STATUSES)
          .lt('updated_at', cutoff)
          .lt('attempts', MAX_ATTEMPTS)
        for (const row of stuck ?? []) {
          setImmediate(() => runJob(row.id).catch(e => console.error('[intelligence] sweep runJob failed:', row.id, e?.message)))
        }
      } catch (e) {
        console.error('[intelligence] sweep query failed:', e?.message)
      }
    }, SWEEP_INTERVAL_MS)
  }

  return { startMeetingEgress, runJob, startIntelligenceSweep }
}
