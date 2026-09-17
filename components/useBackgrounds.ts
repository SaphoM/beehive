import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../livekit_react_hooks'

// ============================================================
// useBackgrounds — a user's library of virtual-background images
// ============================================================
// Replaces the previous single-slot design (one image in localStorage under
// `beehive:bgImage`). A background is a list entry, the user can hold any
// reasonable number of them, and switching is instant — no re-upload.
//
// Two storage backends behind one interface, chosen by whether the user is
// signed in:
//   • cloud  — Supabase Storage bucket `backgrounds` (migration 011), path
//              `{uid}/{timestamp}__{label}.jpg`. Lists the user's folder;
//              syncs across desktop and web like a profile picture does.
//   • local  — a JSON array in localStorage for guests. Same picker, bounded
//              by the ~5 MB quota (roughly 8–10 images at the size we save).
//
// Images are downscaled to ≤1600px-wide JPEG before storing, in both
// backends: the compositing canvas is capped at 1280 wide, so nothing
// visible is lost, and it keeps uploads small and the guest quota usable.
//
// The pipeline in RoomPage never reads this hook directly — it reads one
// HTMLImageElement ref. This hook only manages the list and which entry is
// selected; RoomPage loads the selected entry's URL into that ref.

export interface SavedBackground {
  id: string          // cloud: storage object path; local: generated id
  label: string
  url: string         // cloud: public URL; local: JPEG data URL
  source: 'cloud' | 'local'
}

const BUCKET = 'backgrounds'
const LOCAL_LIBRARY_KEY = 'beehive:bgLibrary'
const SELECTED_KEY = 'beehive:bgSelectedId'
const MAX_WIDTH = 1600
const JPEG_QUALITY = 0.85

// Legacy single-slot keys — migrated into the local library once, then removed.
const LEGACY_IMAGE_KEY = 'beehive:bgImage'
const LEGACY_NAME_KEY = 'beehive:bgImageName'

// Object names carry the label so no companion table is needed. The label is
// sanitised to what Storage accepts in a key; the original is kept readable.
function encodeName(label: string) {
  const safe = label.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Background'
  return `${Date.now()}__${safe}.jpg`
}
function decodeLabel(objectName: string) {
  const m = objectName.match(/^\d+__(.+)\.jpg$/)
  return m ? m[1] : objectName.replace(/\.jpg$/, '')
}

async function downscaleToJpeg(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read that image'))
      i.src = url
    })
    const scale = Math.min(1, MAX_WIDTH / img.width)
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const dataUrl = c.toDataURL('image/jpeg', JPEG_QUALITY)
    const blob = await new Promise<Blob>((resolve, reject) =>
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', JPEG_QUALITY),
    )
    return { blob, dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function readLocal(): SavedBackground[] {
  try {
    const raw = localStorage.getItem(LOCAL_LIBRARY_KEY)
    const list = raw ? (JSON.parse(raw) as SavedBackground[]) : []
    // One-time migration of the old single slot into the list, so nobody
    // loses the background they already had.
    const legacyUrl = localStorage.getItem(LEGACY_IMAGE_KEY)
    const legacyName = localStorage.getItem(LEGACY_NAME_KEY)
    if (legacyUrl && legacyName) {
      const migrated: SavedBackground = { id: `local-${Date.now()}`, label: decodeLabel(legacyName), url: legacyUrl, source: 'local' }
      const next = [...list, migrated]
      localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(next))
      localStorage.removeItem(LEGACY_IMAGE_KEY)
      localStorage.removeItem(LEGACY_NAME_KEY)
      if (!localStorage.getItem(SELECTED_KEY)) localStorage.setItem(SELECTED_KEY, migrated.id)
      return next
    }
    return list
  } catch { return [] }
}
function writeLocal(list: SavedBackground[]) {
  try { localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(list)) } catch { /* quota — caller surfaces the error */ }
}

export function useBackgrounds(userId: string | null | undefined) {
  const [backgrounds, setBackgrounds] = useState<SavedBackground[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    try { return localStorage.getItem(SELECTED_KEY) } catch { return null }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    if (!userId) {
      setBackgrounds(readLocal())
      setLoading(false)
      return
    }
    const { data, error: listError } = await supabase.storage.from(BUCKET).list(userId, {
      limit: 100, sortBy: { column: 'name', order: 'asc' },
    })
    if (listError) {
      setError('Could not load your backgrounds')
      setBackgrounds([])
    } else {
      setBackgrounds((data ?? [])
        .filter(o => o.name.endsWith('.jpg'))
        .map(o => {
          const path = `${userId}/${o.name}`
          return {
            id: path,
            label: decodeLabel(o.name),
            url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
            source: 'cloud' as const,
          }
        }))
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    try { id ? localStorage.setItem(SELECTED_KEY, id) : localStorage.removeItem(SELECTED_KEY) } catch { /* best-effort */ }
  }, [])

  // Adds a background and selects it — the natural expectation right after
  // choosing a file is to see it applied.
  const addBackground = useCallback(async (file: File): Promise<SavedBackground | null> => {
    setError(null)
    let encoded: { blob: Blob; dataUrl: string }
    try { encoded = await downscaleToJpeg(file) } catch (e) {
      setError((e as Error).message)
      return null
    }
    const label = decodeLabel(encodeName(file.name))

    if (!userId) {
      const entry: SavedBackground = { id: `local-${Date.now()}`, label, url: encoded.dataUrl, source: 'local' }
      const next = [...readLocal(), entry]
      try {
        localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(next))
      } catch {
        setError('Out of space for more backgrounds on this device — remove one first, or sign in to save to your account')
        return null
      }
      setBackgrounds(next)
      setSelectedId(entry.id)
      return entry
    }

    const path = `${userId}/${encodeName(file.name)}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, encoded.blob, { contentType: 'image/jpeg', upsert: false })
    if (upErr) {
      setError('Upload failed — check your connection and try again')
      return null
    }
    const entry: SavedBackground = {
      id: path, label,
      url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      source: 'cloud',
    }
    setBackgrounds(prev => [...prev, entry])
    setSelectedId(entry.id)
    return entry
  }, [userId, setSelectedId])

  const removeBackground = useCallback(async (id: string) => {
    setError(null)
    const target = backgrounds.find(b => b.id === id)
    if (!target) return
    if (target.source === 'local') {
      const next = readLocal().filter(b => b.id !== id)
      writeLocal(next)
      setBackgrounds(next)
    } else {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([id])
      if (rmErr) { setError('Could not remove that background'); return }
      setBackgrounds(prev => prev.filter(b => b.id !== id))
    }
    if (selectedId === id) setSelectedId(null)
  }, [backgrounds, selectedId, setSelectedId])

  const selected = backgrounds.find(b => b.id === selectedId) ?? null

  return { backgrounds, selected, selectedId, setSelectedId, addBackground, removeBackground, loading, error, refresh: load }
}
