// ============================================================
// ROOM AUDIO COORDINATION — composite track processor
// ============================================================
// A LiveKit `TrackProcessor` that WRAPS the existing Krisp noise filter
// rather than replacing it: raw mic -> Krisp (unchanged, exact same
// instance/behavior as today) -> a GainNode this class controls -> the
// track LiveKit actually publishes. This is the only safe way to add
// gain-ducking without risking the already-"excellent" (per this feature's
// own brief) Krisp pipeline: LiveKit's `LocalTrack.setProcessor()` holds
// exactly one processor slot, so ducking has to be layered inside a single
// composite processor rather than calling `setProcessor` a second time
// (which would silently replace Krisp instead of adding to it).
//
// Only ever installed when a user explicitly opts into Same-Room Audio
// Coordination (see RoomAudioCoordination.tsx) — everyone else keeps the
// exact plain `KrispNoiseFilter()` processor this app already uses
// (RoomPage.tsx's existing background-noise-suppression effect), byte-for-
// byte unchanged.
//
// Krisp's package is imported dynamically here, not statically — it ships a
// multi-MB WASM/ML payload that RoomPage.tsx's existing Krisp effect already
// deliberately lazy-loads via `import()` to keep it out of the initial
// bundle. A static import here would have pulled that same payload back
// into the main chunk eagerly for every user, coordination feature or not —
// confirmed directly: an earlier static-import version of this file grew
// the built bundle from ~1.3MB to ~7MB. Every entry point below awaits a
// dynamic import before touching Krisp.
import type { AudioProcessorOptions, Room, TrackProcessor } from 'livekit-client'
import { Track } from 'livekit-client'
import type { KrispNoiseFilterProcessor } from '@livekit/krisp-noise-filter'

// Ducked level, not a hard mute — "no clipped words" (mission requirement)
// rules out gating the track fully closed/open, since the very first
// syllable after un-ducking would otherwise be clipped by the ramp. -18dB
// (~0.126 linear) is audible-but-clearly-secondary, the same target Zoom/
// Teams-style "de-emphasize non-active-speaker" implementations use rather
// than a full mute.
const DUCKED_GAIN = 0.126
const NORMAL_GAIN = 1.0
// 80ms ramp — fast enough to feel instantaneous (mission: "nearly
// instantaneous", "no noticeable delays") while still using a ramp (not a
// step) so there's no audible click/pop at the transition instant.
const RAMP_SECONDS = 0.08

export class RoomCoordinationProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'beehive-room-coordination'
  processedTrack?: MediaStreamTrack

  private krisp?: KrispNoiseFilterProcessor
  private audioContext?: AudioContext
  private sourceNode?: MediaStreamAudioSourceNode
  private gainNode?: GainNode
  private destinationNode?: MediaStreamAudioDestinationNode
  private ducked = false

  init = async (opts: AudioProcessorOptions) => {
    const { KrispNoiseFilter } = await import('@livekit/krisp-noise-filter')
    this.krisp = KrispNoiseFilter()
    // Krisp does its own noise-suppression work first, completely
    // unmodified — this class never touches its internals, only reads the
    // `processedTrack` it produces.
    await this.krisp.init(opts)
    this.buildGainGraph(opts.audioContext)
  }

  private buildGainGraph(audioContext: AudioContext) {
    const krispTrack = this.krisp?.processedTrack
    if (!krispTrack) return
    this.audioContext = audioContext
    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([krispTrack]))
    this.gainNode = audioContext.createGain()
    this.gainNode.gain.value = this.ducked ? DUCKED_GAIN : NORMAL_GAIN
    this.destinationNode = audioContext.createMediaStreamDestination()
    this.sourceNode.connect(this.gainNode).connect(this.destinationNode)
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0]
  }

  private teardownGainGraph() {
    try { this.sourceNode?.disconnect() } catch { /* already disconnected */ }
    try { this.gainNode?.disconnect() } catch { /* already disconnected */ }
    this.sourceNode = undefined
    this.gainNode = undefined
    this.destinationNode = undefined
  }

  // Smoothly ramps toward the ducked or normal gain level — called from
  // RoomAudioCoordination.tsx's speaking-state effect, never from within
  // this class (it has no opinion on *when* to duck, only *how*).
  setDucked(ducked: boolean) {
    this.ducked = ducked
    const ctx = this.audioContext
    const gain = this.gainNode
    if (!ctx || !gain) return
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(ducked ? DUCKED_GAIN : NORMAL_GAIN, ctx.currentTime + RAMP_SECONDS)
  }

  restart = async (opts: AudioProcessorOptions) => {
    this.teardownGainGraph()
    await this.krisp?.restart(opts)
    this.buildGainGraph(opts.audioContext)
  }

  onPublish = async (room: Room) => {
    await this.krisp?.onPublish(room)
  }

  destroy = async () => {
    this.teardownGainGraph()
    await this.krisp?.destroy()
  }
}

// Same-room coordination is layered strictly on top of Krisp, so it can
// never be more broadly supported than Krisp itself — and additionally
// needs `MediaStreamAudioDestinationNode`, which is universal in every
// browser this app already targets but checked explicitly rather than
// assumed. Krisp's own support check is imported dynamically too, for the
// same bundle-size reason as above — this function is called from
// RoomAudioCoordination.tsx well before any coordination feature is
// actually used, so it can't be allowed to force-load the WASM payload.
export async function isRoomCoordinationSupported(): Promise<boolean> {
  if (typeof MediaStreamAudioDestinationNode === 'undefined') return false
  const { isKrispNoiseFilterSupported } = await import('@livekit/krisp-noise-filter')
  return isKrispNoiseFilterSupported()
}
