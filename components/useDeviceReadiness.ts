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

const CACHE_KEY = 'beehive:deviceCheck'
const CACHE_TTL = 5 * 60 * 1000

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
  if (navigator.permissions) {
    await Promise.allSettled([
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then(p => { if (p.state === 'denied') result.mic = 'blocked' }),
      navigator.permissions.query({ name: 'camera' as PermissionName })
        .then(p => { if (p.state === 'denied') result.camera = 'blocked' }),
    ])
  }

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
    result.speaker = speakers.length > 0 ? 'ok' : 'missing'

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

// True when audio output is unavailable — callers should warn but not hard-block
export function isCriticalAudioIssue(r: Pick<DeviceReadiness, 'speaker' | 'mic'>): boolean {
  return r.speaker === 'missing' || r.mic === 'blocked'
}
