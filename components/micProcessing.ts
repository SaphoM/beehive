import type { LocalAudioTrack, Room, Track, TrackProcessor, AudioProcessorOptions } from 'livekit-client'

// ============================================================
// Microphone processing — the ONE place BeeHive attaches noise suppression
// ============================================================
// Audited path (livekit-client 2.20.0, verified against its source):
//
//   getUserMedia (AEC + NS + AGC + voiceIsolation on by default)
//     → LocalAudioTrack (raw)
//     → publishTrack → RTP sender carries the RAW track for a moment
//     → LocalTrackPublished → attachMicProcessing() (this file)
//         → track.setProcessor(...) → sender.replaceTrack(processedTrack)
//     → LiveKit → attendees
//
// From then on the sender carries the PROCESSED track, and LocalTrack's
// mediaStreamTrack getter returns it too, so a reconnect republishes the
// processed one. restart() (unmute after stopOnMute, device switch, the
// Windows mic auto-recovery) re-runs processor.restart() on the new
// hardware track and re-points the sender. Those paths are safe.
//
// The pre-publish hook (audioCaptureDefaults.processor) is NOT usable in
// 2.20.0: createLocalTracks calls setProcessor before LocalParticipant sets
// the AudioContext, so it throws every time. Post-publish attach is the
// only working hook; the raw window is Krisp's init time (its module is
// prewarmed in the lobby).
//
// Why noise was still getting through — found by publishing a mic and
// inspecting the sender: Krisp's init() begins with
//
//   track.applyConstraints({ ...track.getSettings(),
//                            noiseSuppression: false, voiceIsolation: false,
//                            sampleRate: audioContext.sampleRate })
//
// Two consequences this module exists to handle:
//  1. It hard-constrains the mic to the AudioContext's sample rate (48 kHz).
//     A mic that cannot capture there — Bluetooth headsets on the HFP
//     profile run at 8/16 kHz, some USB interfaces at 44.1 — throws
//     OverconstrainedError, Krisp never attaches, and the RAW mic is what
//     everyone hears. The old code logged a warning and moved on.
//  2. It switches the browser's own noise suppression OFF to avoid double
//     processing. If that succeeds and Krisp's init then fails (Cloud
//     token, WASM, network), the mic is left with native NS off AND no
//     Krisp — worse than never trying. Nothing restored it.
//
// So: snapshot the native settings first; on any Krisp failure restore
// them; and attach a conservative BeeHive-owned fallback chain instead of
// giving up. Krisp stays the primary — when it runs it is the best filter
// available here, and it is now asked for its 'high' model where the
// machine can afford it.

export type MicProcessingMode = 'krisp' | 'fallback' | 'native-only'
export interface MicProcessingStatus {
  mode: MicProcessingMode
  detail: string
  krispQuality?: 'low' | 'medium' | 'high'
}

let lastStatus: MicProcessingStatus = { mode: 'native-only', detail: 'no microphone published yet' }
const listeners = new Set<(s: MicProcessingStatus) => void>()
export function getMicProcessingStatus() { return lastStatus }
export function onMicProcessingStatus(cb: (s: MicProcessingStatus) => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function setStatus(s: MicProcessingStatus) { lastStatus = s; listeners.forEach(cb => cb(s)) }

// 'high' is a heavier model. Desktop (Electron) machines and anything with
// a reasonable core count take it; phones and thin laptops keep 'medium'.
export function pickKrispQuality(): 'medium' | 'high' {
  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).electronAPI
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 0) : 0
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  return !isMobile && (isDesktopApp || cores >= 4) ? 'high' : 'medium'
}

export async function createKrisp() {
  const { KrispNoiseFilter } = await import('@livekit/krisp-noise-filter')
  return KrispNoiseFilter({ quality: pickKrispQuality() })
}

export async function isKrispSupported(): Promise<boolean> {
  try {
    const { isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')
    return isKrispNoiseFilterSupported()
  } catch { return false }
}

type NativeAudioSettings = { noiseSuppression?: boolean; voiceIsolation?: boolean; echoCancellation?: boolean; autoGainControl?: boolean }
function snapshotNative(track: MediaStreamTrack): NativeAudioSettings {
  const s = track.getSettings() as MediaTrackSettings & { voiceIsolation?: boolean }
  return { noiseSuppression: s.noiseSuppression, voiceIsolation: s.voiceIsolation, echoCancellation: s.echoCancellation, autoGainControl: s.autoGainControl }
}
async function restoreNative(track: MediaStreamTrack, before: NativeAudioSettings) {
  // Only the two Krisp turns off. Never disable anything here — if the
  // snapshot was undefined (synthetic track, older browser) fall back to
  // ON, which is livekit-client's own default for both.
  try {
    await track.applyConstraints({
      noiseSuppression: before.noiseSuppression ?? true,
      // voiceIsolation is not in the TS constraint type yet
      ...({ voiceIsolation: before.voiceIsolation ?? true } as any),
    })
  } catch { /* the track may not support re-constraining; native NS was never turned off in that case */ }
}

const PROCESSOR_NAMES = new Set(['livekit-noise-filter', 'beehive-noise-fallback', 'beehive-room-coordination'])

// Attach noise processing to a published mic track. Idempotent: a track
// that already carries one of our processors is left alone, which is what
// keeps the two callers (RoomPage's publish hook and RoomAudioCoordination's
// swap) from stacking processors on one track.
export async function attachMicProcessing(track: LocalAudioTrack): Promise<MicProcessingStatus> {
  const existing = (track as any).processor as TrackProcessor<Track.Kind.Audio> | undefined
  if (existing && PROCESSOR_NAMES.has(existing.name)) return lastStatus

  const raw = track.mediaStreamTrack
  const before = snapshotNative(raw)

  if (await isKrispSupported()) {
    try {
      const krisp = await createKrisp()
      await track.setProcessor(krisp)
      const quality = pickKrispQuality()
      const s: MicProcessingStatus = { mode: 'krisp', detail: `Krisp (${quality} model)`, krispQuality: quality }
      setStatus(s)
      console.info(`[audio] noise suppression active — ${s.detail}`)
      return s
    } catch (err) {
      // Krisp may have already switched native NS off before failing.
      await restoreNative(raw, before)
      console.warn('[audio] Krisp failed to attach — native suppression restored, using BeeHive fallback chain:', (err as Error)?.message ?? err)
    }
  } else {
    console.warn('[audio] Krisp not supported on this platform — using BeeHive fallback chain')
  }

  try {
    await track.setProcessor(new FallbackNoiseProcessor())
    const s: MicProcessingStatus = { mode: 'fallback', detail: 'native suppression + high-pass + expander' }
    setStatus(s)
    console.info(`[audio] noise suppression active — ${s.detail}`)
    return s
  } catch (err) {
    const s: MicProcessingStatus = { mode: 'native-only', detail: 'browser noise suppression only' }
    setStatus(s)
    console.warn('[audio] fallback chain failed to attach — mic is transmitting with browser suppression only', (err as Error)?.message ?? err)
    return s
  }
}

// ------------------------------------------------------------
// FallbackNoiseProcessor — used only when Krisp cannot run
// ------------------------------------------------------------
// Layered and deliberately conservative. The browser's own AEC/NS/AGC stay
// ON underneath (restored above if Krisp had disabled them); this adds:
//
//   high-pass 90 Hz (Q 0.7)   removes fan / HVAC / desk rumble below the
//                              voice band; no effect on speech formants
//   soft gate / expander       attenuates what is left between phrases by
//                              a fixed -15 dB — NOT a hard mute. The room
//                              stays faintly audible so there is no
//                              "dead air" pumping, and speech is never cut.
//
// No limiter: the browser's AGC already runs underneath, and this chain
// only ever REDUCES gain, so it cannot introduce clipping. Leaving it out
// keeps the added latency to a single worklet quantum.
//
// Gate design (in the worklet): a TRUE RMS envelope (smoothed power, 3 ms
// attack / 20 ms release) — not a peak follower. The envelope release is
// short on purpose: falling from speech to the close threshold is ~27 dB
// (a factor of 500 in power, ~6 time constants), so a slow envelope would
// add most of a second before the hold timer even starts. Anti-chatter
// comes from the hold and hysteresis, not from a sluggish envelope. That distinction is what
// makes the thresholds mean what they say: a peak follower sat ~7 dB above
// broadband noise's real level, inside the hysteresis band, and once
// opened the gate never closed. It also means a 3 ms keyboard click, whose
// energy over 5 ms is well under the open threshold, does not open the
// gate the way its peak level would. Hysteresis: opens at -45 dBFS, closes
// only below -52. 3 ms gain attack so word onsets are never clipped,
// 200 ms hold, then a 100 ms one-pole release (audibly settled ~350 ms
// after speech stops, at the floor by ~550 ms) so gaps between words and
// sentence tails ride through. Closed = the -15 dB floor; between thresholds the state is
// held, so a quiet consonant never flips it shut.
// Chrome's AGC normalises speech to roughly -20…-30 dBFS RMS; room noise
// after native NS sits around -55…-65 dBFS; keyboard transients peak near
// -35…-45 dBFS for a few ms. The thresholds sit between speech and residue,
// and the timing constants are what keep this from ever pumping.
// Latency: one 128-sample worklet quantum ≈ 2.7 ms at 48 kHz.
export const EXPANDER_WORKLET = `
class BhvExpander extends AudioWorkletProcessor {
  constructor() {
    super()
    this.env = 0; this.gain = 1; this.holdLeft = 0; this.open = false
    this.OPEN = -45; this.CLOSE = -52; this.FLOOR_DB = -15
    this.ATTACK = Math.exp(-1 / (0.003 * sampleRate)); this.RELEASE = Math.exp(-1 / (0.100 * sampleRate))
    this.ENV_ATT = Math.exp(-1 / (0.003 * sampleRate)); this.ENV_REL = Math.exp(-1 / (0.020 * sampleRate))
    this.HOLD = Math.round(0.200 * sampleRate)
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]
    if (!inp || !inp[0]) return true
    const n = inp[0].length
    for (let i = 0; i < n; i++) {
      let p = 0
      for (let c = 0; c < inp.length; c++) p += inp[c][i] * inp[c][i]
      p /= inp.length
      // power-domain smoothing = true RMS, not a peak follower
      this.env = p > this.env ? this.ENV_ATT * this.env + (1 - this.ENV_ATT) * p : this.ENV_REL * this.env + (1 - this.ENV_REL) * p
      const db = 10 * Math.log10(this.env + 1e-12)
      if (db > this.OPEN) { this.open = true; this.holdLeft = this.HOLD }
      else if (this.open && db < this.CLOSE) { if (this.holdLeft > 0) this.holdLeft--; else this.open = false }
      const target = this.open ? 1 : Math.pow(10, this.FLOOR_DB / 20)
      this.gain = target > this.gain ? this.ATTACK * this.gain + (1 - this.ATTACK) * target : this.RELEASE * this.gain + (1 - this.RELEASE) * target
      for (let c = 0; c < out.length; c++) out[c][i] = inp[Math.min(c, inp.length - 1)][i] * this.gain
    }
    return true
  }
}
registerProcessor('bhv-expander', BhvExpander)
`
let workletUrl: string | null = null
const workletReady = new WeakSet<AudioContext>()
async function ensureWorklet(ctx: AudioContext): Promise<boolean> {
  if (workletReady.has(ctx)) return true
  if (!ctx.audioWorklet) return false
  try {
    workletUrl ??= URL.createObjectURL(new Blob([EXPANDER_WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(workletUrl)
    workletReady.add(ctx)
    return true
  } catch { return false }
}

export class FallbackNoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'beehive-noise-fallback'
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private nodes: AudioNode[] = []
  private dest?: MediaStreamAudioDestinationNode

  init = async (opts: AudioProcessorOptions) => { await this.build(opts) }
  restart = async (opts: AudioProcessorOptions) => { this.teardown(); await this.build(opts) }
  onPublish = async (_room: Room) => { /* nothing to negotiate */ }
  destroy = async () => { this.teardown() }

  private async build(opts: AudioProcessorOptions) {
    const ctx = opts.audioContext
    this.ctx = ctx
    const src = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7
    this.dest = ctx.createMediaStreamDestination()
    // Mono, matching the capture constraint (channelCount: 1) — a stereo
    // destination would upmix and double the encoder's work for nothing.
    this.dest.channelCount = 1; this.dest.channelCountMode = 'explicit'
    const chain: AudioNode[] = [src, hp]
    if (await ensureWorklet(ctx)) chain.push(new AudioWorkletNode(ctx, 'bhv-expander', { outputChannelCount: [1] }))
    chain.push(this.dest)
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1])
    this.nodes = chain
    this.processedTrack = this.dest.stream.getAudioTracks()[0]
  }
  private teardown() {
    for (const n of this.nodes) { try { n.disconnect() } catch { /* already */ } }
    this.nodes = []
    this.dest = undefined
    // The AudioContext belongs to LiveKit — never closed here.
  }
}
