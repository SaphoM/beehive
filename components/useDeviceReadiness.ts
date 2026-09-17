import { useState, useEffect, useCallback } from 'react'

// ============================================================
// useDeviceReadiness — async pre-join device & permission check
// ============================================================
// Checks mic, camera, and speaker availability + browser/OS
// permissions WITHOUT prompting the user (permissions API only,
// plus enumerateDevices which never triggers a prompt).
//
// Results are cached in localStorage for 5 minutes and
// invalidated immediately on any devicechange event so that
// plugging/unplugging headphones is reflected straight away.
//
// Deliberately NEVER calls getUserMedia() — that prompt is
// already handled by RoomPage's existing warm-up effect on
// view==='room'. This hook is additive and read-only.

export type DeviceStatus = 'ok' | 'blocked' | 'missing' | 'unknown' | 'checking'

export interface DeviceReadiness {
  loading: boolean
  mic: DeviceStatus
  camera: DeviceStatus
  speaker: DeviceStatus
  micLabel: string
  cameraLabel: string
  speakerLabel: string
  recheck: () => void
}

interface CachedCheck {
  ts: number
  mic: DeviceStatus
  camera: DeviceStatus
  speaker: DeviceStatus
  micLabel: string
  cameraLabel: string
  speakerLabel: string
}

// Bumped to :v2 when the speaker false-positive below was fixed — a stale
// cached `speaker: 'missing'` would otherwise keep showing the bogus warning
// for up to CACHE_TTL after the update.
export const DEVICE_CHECK_CACHE_KEY = 'beehive:deviceCheck:v2'
const CACHE_KEY = DEVICE_CHECK_CACHE_KEY
const CACHE_TTL = 5 * 60 * 1000

// Never prompts. Safari doesn't support querying 'microphone'/'camera' and
// throws, which lands in the catch as 'unsupported'.
async function queryPermission(name: 'microphone' | 'camera'): Promise<PermissionState | 'unsupported'> {
  try {
    if (!navigator.permissions?.query) return 'unsupported'
    const p = await navigator.permissions.query({ name: name as PermissionName })
    return p.state
  } catch { return 'unsupported' }
}

async function runCheck(): Promise<Omit<CachedCheck, 'ts'>> {
  const result = {
    mic: 'unknown' as DeviceStatus,
    camera: 'unknown' as DeviceStatus,
    speaker: 'unknown' as DeviceStatus,
    micLabel: '',
    cameraLabel: '',
    speakerLabel: '',
  }

  // Fast path: permissions API (no prompt, instant)
  const [micPerm, camPerm] = await Promise.all([
    queryPermission('microphone'),
    queryPermission('camera'),
  ])
  if (micPerm === 'denied') result.mic = 'blocked'
  if (camPerm === 'denied') result.camera = 'blocked'

  // Device enumeration — never prompts; labels hidden until permission granted
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics = devices.filter(d => d.kind === 'audioinput')
    const cams = devices.filter(d => d.kind === 'videoinput')
    const speakers = devices.filter(d => d.kind === 'audiooutput')

    if (result.mic !== 'blocked')
      result.mic = mics.length > 0 ? 'ok' : 'missing'
    if (result.camera !== 'blocked')
      result.camera = cams.length > 0 ? 'ok' : 'missing'

    // An empty audiooutput list usually means "this browser won't tell us",
    // NOT "this machine has no speakers". Treating it as missing produced a
    // false "No audio output device found" on Macs whose speakers work fine,
    // which also flipped the primary button into its muted "Resolve Audio
    // Issue" state and stood in the way of a normal join.
    //
    // Two distinct reasons the list can be empty on a healthy machine:
    //  1. Safari (and Firefox by default) never enumerate audiooutput at all.
    //     setSinkId is the capability that governs output-device selection, so
    //     feature-detecting it tells us whether the list is meaningful here.
    //  2. Chromium withholds audiooutput entries until microphone permission
    //     is granted, since output identity is a fingerprinting vector. A
    //     non-empty label on any device proves permission was granted, which
    //     is a more reliable signal than the Permissions API alone (Safari
    //     has no 'microphone' query and reports 'unsupported').
    //
    // Only when the list is genuinely trustworthy AND empty do we report
    // 'missing' — preserving the true positive of every output unplugged.
    const supportsOutputEnumeration =
      typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
    const canTrustOutputList =
      supportsOutputEnumeration && (micPerm === 'granted' || devices.some(d => d.label !== ''))
    result.speaker = speakers.length > 0
      ? 'ok'
      : canTrustOutputList ? 'missing' : 'unknown'

    result.micLabel = mics[0]?.label || (mics.length > 0 ? 'Microphone' : '')
    result.cameraLabel = cams[0]?.label || (cams.length > 0 ? 'Camera' : '')
    result.speakerLabel = speakers[0]?.label || (speakers.length > 0 ? 'Speaker' : '')
  } catch { /* mediaDevices unavailable */ }

  return result
}

const INIT: Omit<DeviceReadiness, 'recheck'> = {
  loading: true,
  mic: 'checking', camera: 'checking', speaker: 'checking',
  micLabel: '', cameraLabel: '', speakerLabel: '',
}

export function useDeviceReadiness(): DeviceReadiness {
  const [state, setState] = useState<Omit<DeviceReadiness, 'recheck'>>(INIT)

  const check = useCallback(async (skipCache = false) => {
    if (!skipCache) {
      try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (raw) {
          const c: CachedCheck = JSON.parse(raw)
          if (Date.now() - c.ts < CACHE_TTL) {
            setState({ loading: false, mic: c.mic, camera: c.camera, speaker: c.speaker, micLabel: c.micLabel, cameraLabel: c.cameraLabel, speakerLabel: c.speakerLabel })
            return
          }
        }
      } catch { /* storage unavailable */ }
    }

    setState(prev => ({ ...prev, loading: true }))
    const r = await runCheck()
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), ...r })) } catch { /* storage unavailable */ }
    setState({ loading: false, ...r })
  }, [])

  useEffect(() => {
    if (!navigator?.mediaDevices) {
      setState({ loading: false, mic: 'unknown', camera: 'unknown', speaker: 'unknown', micLabel: '', cameraLabel: '', speakerLabel: '' })
      return
    }
    check()
    const onChange = () => check(true)
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange)
  }, [check])

  return { ...state, recheck: () => check(true) }
}

// True when audio output is unavailable — callers should warn but not hard-block.
// Deliberately checks 'missing' and not 'unknown': an unknown speaker just means
// the browser hasn't exposed output devices yet (no mic permission), which is the
// default state for every first-time visitor and must not be treated as a fault.
export function isCriticalAudioIssue(r: Pick<DeviceReadiness, 'speaker' | 'mic'>): boolean {
  return r.speaker === 'missing' || r.mic === 'blocked'
}
