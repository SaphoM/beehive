// ============================================================
// SAME-ROOM SUSPICION HEURISTIC
// ============================================================
// A real, working signal for "these two BeeHive participants might be
// physically in the same room" — not a stub. The underlying idea is the
// same physical fact that causes acoustic feedback/echo in the first
// place: if participant B is in the same room as participant A, A's own
// microphone picks up B's voice acoustically (through the air) at almost
// exactly the same moments B's own mic does — the two signals' loudness
// envelopes move together. Two people in different rooms/houses have
// acoustically independent mics: one person's loudness contour has no
// reason to track another's.
//
// This computes a rolling Pearson correlation between the *local* mic's
// loudness-over-time and each *remote* participant's loudness-over-time. A
// sustained high correlation is the suggestion signal — never an automatic
// action. Explicitly a *heuristic*: it can misfire (e.g. two people
// speaking in a tight back-and-forth rhythm could transiently correlate
// without being in the same room), which is exactly why it only ever
// produces a dismissible suggestion (RoomAudioCoordination.tsx), never
// enables coordination by itself. Real-world accuracy of this specific
// threshold/window combination has NOT been validated against live
// multi-device audio in this environment — flagged plainly in this
// project's delivery notes rather than claimed as proven.
import { useEffect, useRef, useState } from 'react'

const SAMPLE_INTERVAL_MS = 100
const WINDOW_SAMPLES = 30 // 3s of history at the sample interval above
const CORRELATION_THRESHOLD = 0.55
// Requires the correlation to stay above threshold for this many
// consecutive samples (not just one lucky instant) before suspecting
// anything — sustained correlation is a much stronger signal than a
// single high reading, which coincidental speech timing can produce.
const SUSTAINED_SAMPLES_REQUIRED = 20 // ~2s sustained

function rms(data: Uint8Array): number {
  let sumSquares = 0
  for (let i = 0; i < data.length; i++) {
    const centered = (data[i] - 128) / 128
    sumSquares += centered * centered
  }
  return Math.sqrt(sumSquares / data.length)
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 5) return 0
  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i] }
  const meanA = sumA / n, meanB = sumB / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return 0
  return cov / Math.sqrt(varA * varB)
}

interface TrackedStream {
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  history: number[]
  aboveThresholdStreak: number
}

// `localRawTrack` is deliberately the *pre-Krisp* mic capture (see
// RoomAudioCoordination.tsx) — Krisp's whole job is suppressing exactly the
// "another person's voice bleeding in acoustically" signal this heuristic
// needs to see, so detecting on the already-cleaned track would blind it.
export function useSameRoomDetection(
  localRawTrack: MediaStreamTrack | null,
  remoteTracks: { identity: string; track: MediaStreamTrack }[],
  enabled: boolean,
): Set<string> {
  const [suspected, setSuspected] = useState<Set<string>>(new Set())
  const audioContextRef = useRef<AudioContext | null>(null)
  const localRef = useRef<TrackedStream | null>(null)
  const remoteMapRef = useRef<Map<string, TrackedStream>>(new Map())

  useEffect(() => {
    if (!enabled || !localRawTrack || remoteTracks.length === 0) {
      setSuspected(new Set())
      return
    }

    let cancelled = false
    const ctx = new AudioContext()
    audioContextRef.current = ctx

    const track = (mst: MediaStreamTrack): TrackedStream => {
      const source = ctx.createMediaStreamSource(new MediaStream([mst]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      return { analyser, source, history: [], aboveThresholdStreak: 0 }
    }

    localRef.current = track(localRawTrack)
    const remoteMap = new Map<string, TrackedStream>()
    for (const r of remoteTracks) remoteMap.set(r.identity, track(r.track))
    remoteMapRef.current = remoteMap

    const buf = new Uint8Array(512)
    const tick = setInterval(() => {
      if (cancelled) return
      const local = localRef.current
      if (!local) return
      local.analyser.getByteTimeDomainData(buf)
      local.history.push(rms(buf))
      if (local.history.length > WINDOW_SAMPLES) local.history.shift()

      const nextSuspected = new Set<string>()
      for (const [identity, remote] of remoteMap) {
        remote.analyser.getByteTimeDomainData(buf)
        remote.history.push(rms(buf))
        if (remote.history.length > WINDOW_SAMPLES) remote.history.shift()

        const corr = pearsonCorrelation(local.history, remote.history)
        if (corr >= CORRELATION_THRESHOLD) {
          remote.aboveThresholdStreak++
        } else {
          remote.aboveThresholdStreak = 0
        }
        if (remote.aboveThresholdStreak >= SUSTAINED_SAMPLES_REQUIRED) nextSuspected.add(identity)
      }
      setSuspected(prev => {
        if (prev.size === nextSuspected.size && [...prev].every(id => nextSuspected.has(id))) return prev
        return nextSuspected
      })
    }, SAMPLE_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(tick)
      try { localRef.current?.source.disconnect() } catch { /* already gone */ }
      for (const r of remoteMapRef.current.values()) {
        try { r.source.disconnect() } catch { /* already gone */ }
      }
      remoteMapRef.current = new Map()
      localRef.current = null
      ctx.close().catch(() => {})
      audioContextRef.current = null
    }
    // remoteTracks is an array (new identity each render) — depend on a
    // stable key instead so this doesn't tear down/rebuild the whole
    // analyser graph every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRawTrack, enabled, remoteTracks.map(r => r.identity + ':' + r.track.id).join(',')])

  return suspected
}
