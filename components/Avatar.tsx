// ============================================================
// AVATAR — initials fallback + profile-picture upload
// ============================================================
// Single shared source for "how does a user's avatar render" across the
// whole app (meeting tiles, participant list, chat, raised hands, waiting
// room, the lobby's own self-display) — every call site renders the exact
// same initials/colour/image logic, so there's no risk of one spot showing
// stale initials while another shows the real photo.

import { useState, useRef, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { supabase } from '../livekit_react_hooks'

// ------------------------------------------------------------
// Initials
// ------------------------------------------------------------
// "Sapho Maqhwazima" -> "SM", "John Smith" -> "JS", "Mary Ann Brown" -> "MB"
// (first + last word, middle words ignored — matches every reference app's
// convention), "Cher" -> "C" (single word: no second letter to pair it
// with). Unicode-aware: \p{L}/\p{N} with the `u` flag strips punctuation
// without assuming Latin script, and spreading the string with `[...str]`
// takes whole codepoints rather than UTF-16 code units, so composed
// international characters aren't split apart.
export function getInitials(name: string | null | undefined): string {
  const trimmed = (name ?? '').normalize('NFC').trim()
  if (!trimmed) return '?'
  const cleaned = trimmed.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return '?'
  const words = cleaned.split(' ').filter(Boolean)
  if (words.length === 1) return [...words[0]][0].toUpperCase()
  const first = [...words[0]][0]
  const last = [...words[words.length - 1]][0]
  return (first + last).toUpperCase()
}

// ------------------------------------------------------------
// Deterministic colour
// ------------------------------------------------------------
// A curated palette of soft, modern, high-contrast-with-white colours (not
// an arbitrary `hsl(hash % 360, ...)` generator, which produces muddy or
// neon results for plenty of hash values) — a simple string hash just picks
// which one, so the same name always lands on the same colour, but every
// colour it can land on was chosen to look good.
const AVATAR_PALETTE = [
  '#4A90D9', // blue
  '#7B61FF', // purple
  '#2FAE6E', // green
  '#E8833A', // orange
  '#1AA3A3', // teal
  '#D65A8D', // rose
  '#5C6BC0', // indigo
  '#3D8B7D', // sea green
]

export function getAvatarColor(name: string | null | undefined): string {
  const key = (name ?? '').trim() || '?'
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.codePointAt(i)!) | 0
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

// ------------------------------------------------------------
// <Avatar/> — the one component every call site renders
// ------------------------------------------------------------
// Renders the real picture when `avatarUrl` is set and loads successfully;
// falls back to the initials circle immediately (no broken-image icon, no
// blank placeholder) if there's no URL, or if the image fails to load.
export function Avatar({ name, avatarUrl, size = 36, style, className }: {
  name: string
  avatarUrl?: string | null
  size?: number
  style?: React.CSSProperties
  className?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = !!avatarUrl && !imgFailed
  const label = name || 'Unknown'

  const common: React.CSSProperties = {
    width: size, height: size, minWidth: size, minHeight: size, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', userSelect: 'none', flexShrink: 0, ...style,
  }

  if (showImage) {
    return (
      <img
        src={avatarUrl!}
        alt={label}
        title={label}
        loading="lazy"
        onError={() => setImgFailed(true)}
        style={{ ...common, objectFit: 'cover', background: '#1a1a1a' }}
        className={className}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      style={{
        ...common,
        background: getAvatarColor(name),
        color: '#fff',
        fontWeight: 600,
        fontFamily: "'Roboto', sans-serif",
        fontSize: Math.max(10, Math.round(size * 0.4)),
        lineHeight: 1,
      }}
      className={className}
    >
      {getInitials(name)}
    </div>
  )
}

// ------------------------------------------------------------
// Profile-picture upload
// ------------------------------------------------------------
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
// 320px — sharp enough for a ~160px on-screen avatar at 2x DPI (the largest
// this app renders one at), without shipping a full-resolution photo.
const OUTPUT_SIZE = 320

// Validates, center-crops to square, resizes, and compresses via Canvas —
// no image-processing dependency needed, this app already relies on Canvas
// 2D for the virtual-background pipeline, so the same browser-native
// primitive covers this too, in both the web build and Electron.
// "Center the face where practical": without a face-detection model, a
// plain center crop is the practical baseline (every simple avatar system
// without an ML pipeline does exactly this) — true face-aware cropping
// would be a meaningfully bigger feature, intentionally out of scope here.
async function processAvatarImage(file: File): Promise<{ blob: Blob } | { error: string }> {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return { error: 'Unsupported file type — please choose a JPG, PNG, or WEBP image.' }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { error: 'Could not read this image — it may be corrupted.' }
  }

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  // White backdrop before drawing — a transparent PNG (a listed test case)
  // would otherwise flatten to canvas's default transparent-black when
  // exported as JPEG (which has no alpha channel), showing as a black
  // square instead of a clean avatar.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  bitmap.close()

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) return { error: 'Could not process this image.' }
  return { blob }
}

// Uploads to the `avatars` Supabase Storage bucket (see
// supabase/migrations/005_avatars_bucket.sql) at `{userId}/{timestamp}.jpg`
// — RLS restricts writes to that exact path prefix matching the caller's
// own auth id, so a user can only ever write into their own folder. Returns
// the new public URL on success; the caller is responsible for saving it
// via `updateProfile({ avatar_url })` (from `useProfile`, `livekit_react_
// hooks.tsx`) so every already-open tab picks it up next fetch/render.
export async function uploadAvatar(file: File, userId: string): Promise<{ url?: string; error?: string }> {
  const result = await processAvatarImage(file)
  if ('error' in result) return { error: result.error }

  const path = `${userId}/${Date.now()}.jpg`
  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(path, result.blob, { contentType: 'image/jpeg', upsert: true })
  if (error || !data) return { error: error?.message ?? 'Upload failed' }

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(data.path)
  return { url: publicUrl }
}

// ------------------------------------------------------------
// <EditableAvatar/> — self-display with upload/remove, both entry points
// ------------------------------------------------------------
// Method 1: click the avatar itself -> a small menu with "Upload profile
// picture" (and "Remove profile picture" once one exists).
// Method 2: `showChangeLink` renders a plain secondary "Change profile
// picture" text link beside it, wired to the exact same file input and
// upload path — this app has no dedicated settings/profile page to host it
// on, so it's placed directly next to the avatar it controls instead of
// inventing new navigation for it.
export function EditableAvatar({ name, avatarUrl, userId, size = 72, onUpdated, showChangeLink }: {
  name: string
  avatarUrl?: string | null
  userId: string
  size?: number
  onUpdated: (url: string | null) => void
  showChangeLink?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menuOpen])

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    const { url, error } = await uploadAvatar(file, userId)
    setBusy(false)
    if (error) { setError(error); return }
    if (url) onUpdated(url)
  }

  const menuBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    background: 'none', border: 'none', color: '#ddd', fontSize: 13, fontFamily: "'Roboto', sans-serif",
    padding: '9px 12px', cursor: 'pointer',
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', display: 'inline-flex' }} ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          disabled={busy}
          aria-label={avatarUrl ? 'Change profile picture' : 'Upload profile picture'}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={avatarUrl ? 'Change profile picture' : 'Upload profile picture'}
          style={{ background: 'none', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', borderRadius: '50%', position: 'relative', display: 'flex' }}
        >
          <Avatar name={name} avatarUrl={avatarUrl} size={size} />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', bottom: -2, right: -2, width: Math.max(18, size * 0.32), height: Math.max(18, size * 0.32),
              borderRadius: '50%', background: '#f5a623', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #0a0a0a',
            }}
          >
            <Camera size={Math.max(9, size * 0.16)} color="#000" />
          </span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 8,
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
              minWidth: 190, overflow: 'hidden', zIndex: 50,
            }}
          >
            <button role="menuitem" style={menuBtnStyle} onClick={() => { setMenuOpen(false); inputRef.current?.click() }}>
              Upload profile picture
            </button>
            {avatarUrl && (
              <button
                role="menuitem"
                style={{ ...menuBtnStyle, color: '#e57373', borderTop: '1px solid #2a2a2a' }}
                onClick={() => { setMenuOpen(false); onUpdated(null) }}
              >
                Remove profile picture
              </button>
            )}
          </div>
        )}
      </div>

      {showChangeLink && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            background: 'none', border: 'none', color: '#f5a623', fontSize: 11,
            fontFamily: "'Roboto', sans-serif", cursor: busy ? 'default' : 'pointer', padding: 0,
          }}
        >
          {busy ? 'Uploading…' : 'Change profile picture'}
        </button>
      )}

      {error && (
        <span role="alert" style={{ color: '#e57373', fontSize: 11, fontFamily: "'Roboto', sans-serif", textAlign: 'center', maxWidth: 200 }}>
          {error}
        </span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        aria-label="Choose an image file"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) handleFile(file)
        }}
      />
    </div>
  )
}
