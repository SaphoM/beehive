export const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥']

const REACTION_TEMPLATES: Record<string, (name: string) => string> = {
  '👍': name => `${name} agrees.`,
  '❤️': name => `${name} loves this.`,
  '😂': name => `${name} found this hilarious.`,
  '🎉': name => `${name} is celebrating!`,
  '👏': name => `${name} applauds this.`,
  '🔥': name => `${name} thinks this is 🔥`,
}

export function getReactionTemplate(emoji: string, name: string): string {
  return REACTION_TEMPLATES[emoji]?.(name) ?? `${name} reacted.`
}
export const QUALITY_OPTIONS = ['Low (360p)', 'Medium (720p)', 'High (1080p)']
export const APP_NAME = 'BeeHive'
export const SUBTEXTS = ['Meet', 'Sting'] as const
export type Subtext = typeof SUBTEXTS[number]

// Sting mode's accent colour, shared by Lobby (logo, active tab) and
// SchedulePanel (Create button) so both stay in sync from one source.
// The original #a91b1b measured only ~2.3–2.7:1 contrast against this app's
// dark backgrounds (#161616 / #1e1e1e / #0a0a0a) — well under WCAG AA's 3:1
// minimum for large text. #ef4444 (Tailwind red-500) measures ~4.8–5.2:1
// against those same backgrounds — passes AA for normal text too — while
// still reading unambiguously as red, not pink or orange.
export const STING_RED = '#ef4444'

export const WEB_BASE = (import.meta.env.VITE_WEB_BASE_URL as string | undefined)?.replace(/\/$/, '')
  || (typeof window !== 'undefined' && window.location.protocol !== 'file:' ? window.location.origin : '')

// BeeHive is in private Beta — accounts are provisioned by X Spark rather than
// self-served, so "Register" points people here. Shared by AuthScreen and the
// Lobby's RegisterPanel so both stay in sync from one source.
export const REQUEST_ACCESS_EMAIL = 'studio@xspark.co.za'
export const REQUEST_ACCESS_MAILTO =
  `mailto:${REQUEST_ACCESS_EMAIL}` +
  `?subject=${encodeURIComponent('BeeHive Beta access request')}` +
  `&body=${encodeURIComponent(
    "Hi X Spark,\n\nI'd like to request access to the BeeHive Beta.\n\nName:\nOrganisation:\nEmail:\n\nThanks!",
  )}`

export const PRESENTATION_EXTS = ['.key', '.keynote', '.pptx', '.ppt', '.odp', '.pdf']
export const PRESENTATION_APP: Record<string, string> = {
  '.key': 'Keynote', '.keynote': 'Keynote',
  '.pptx': 'PowerPoint', '.ppt': 'PowerPoint',
  '.odp': 'Impress',
  '.pdf': 'Preview',
}

export function isPresentationFile(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return PRESENTATION_EXTS.includes(ext)
}

export function presentationApp(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return PRESENTATION_APP[ext] ?? 'the app'
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return '🗜️'
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📽️'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  return '📎'
}

export async function ensureMediaPipe(): Promise<void> {
  if ((window as any).SelfieSegmentation) return
  if (!document.querySelector('script[data-mp-ss]')) {
    const s = document.createElement('script')
    s.setAttribute('data-mp-ss', '1')
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js'
    s.crossOrigin = 'anonymous'
    document.head.appendChild(s)
  }
  await new Promise<void>((resolve, reject) => {
    if ((window as any).SelfieSegmentation) { resolve(); return }
    const check = setInterval(() => {
      if ((window as any).SelfieSegmentation) { clearInterval(check); resolve() }
    }, 100)
    setTimeout(() => { clearInterval(check); reject(new Error('MediaPipe load timeout')) }, 20000)
  })
}

export type VirtualPreset = { id: string; label: string; preview: string[] }
export const VIRTUAL_PRESETS: VirtualPreset[] = [
  { id: 'office',    label: 'Office',    preview: ['#d6d3d1', '#a8a29e'] },
  { id: 'beach',     label: 'Beach',     preview: ['#0284c7', '#fbbf24'] },
  { id: 'city',      label: 'City',      preview: ['#0f172a', '#334155'] },
  { id: 'forest',    label: 'Forest',    preview: ['#14532d', '#15803d'] },
  { id: 'mountains', label: 'Mountains', preview: ['#312e81', '#4f46e5'] },
  { id: 'space',     label: 'Space',     preview: ['#030712', '#1e1b4b'] },
  { id: 'sunset',    label: 'Sunset',    preview: ['#7c3aed', '#f97316'] },
  { id: 'studio',    label: 'Studio',    preview: ['#27272a', '#18181b'] },
]

export function drawVirtualScene(ctx: CanvasRenderingContext2D, id: string, W: number, H: number) {
  switch (id) {
    case 'office': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#e7e5e4'); g.addColorStop(1, '#a8a29e')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#78350f'; ctx.fillRect(0, H * 0.75, W, H * 0.25)
      ctx.fillStyle = '#6b2800'; ctx.fillRect(0, H * 0.74, W, 5)
      break
    }
    case 'beach': {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62)
      sky.addColorStop(0, '#0369a1'); sky.addColorStop(1, '#38bdf8')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.62)
      ctx.fillStyle = '#0284c7'; ctx.fillRect(0, H * 0.57, W, H * 0.1)
      const sand = ctx.createLinearGradient(0, H * 0.65, 0, H)
      sand.addColorStop(0, '#fde68a'); sand.addColorStop(1, '#b45309')
      ctx.fillStyle = sand; ctx.fillRect(0, H * 0.65, W, H * 0.35)
      break
    }
    case 'city': {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#0f172a'); sky.addColorStop(1, '#1e293b')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
      const buildings = [
        { x: 0, w: 80, h: H * 0.55 }, { x: 70, w: 50, h: H * 0.4 },
        { x: 110, w: 90, h: H * 0.65 }, { x: 190, w: 60, h: H * 0.45 },
        { x: 240, w: 100, h: H * 0.7 }, { x: 330, w: 70, h: H * 0.5 },
        { x: 390, w: 120, h: H * 0.6 }, { x: 500, w: 80, h: H * 0.42 },
        { x: 570, w: 70, h: H * 0.68 },
      ]
      ctx.fillStyle = '#334155'
      buildings.forEach(b => ctx.fillRect(b.x, H - b.h, b.w, b.h))
      ctx.fillStyle = 'rgba(253,230,138,0.75)'
      buildings.forEach(b => {
        const cols = Math.floor(b.w / 14)
        const rows = Math.min(8, Math.floor(b.h / 18))
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            if (((row * 7 + col * 3) % 5) !== 0)
              ctx.fillRect(b.x + col * 14 + 3, H - b.h + row * 18 + 8, 6, 8)
          }
        }
      })
      break
    }
    case 'forest': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#14532d'); g.addColorStop(1, '#052e16')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#713f12'
      for (let i = 0; i < 8; i++) ctx.fillRect(i * 85 + 30, H * 0.35, 12, H * 0.65)
      ctx.fillStyle = '#166534'
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.arc(i * 85 + 36, H * 0.35, 44, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'mountains': {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#1e1b4b'); sky.addColorStop(1, '#4f46e5')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#4338ca'
      ctx.beginPath()
      ctx.moveTo(0, H); ctx.lineTo(0, H * 0.5); ctx.lineTo(120, H * 0.2)
      ctx.lineTo(200, H * 0.45); ctx.lineTo(320, H * 0.1); ctx.lineTo(440, H * 0.4)
      ctx.lineTo(560, H * 0.15); ctx.lineTo(W, H * 0.5); ctx.lineTo(W, H)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#e0e7ff'
      ctx.beginPath(); ctx.moveTo(120, H * 0.2); ctx.lineTo(100, H * 0.32); ctx.lineTo(140, H * 0.32); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(320, H * 0.1); ctx.lineTo(298, H * 0.25); ctx.lineTo(342, H * 0.25); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(560, H * 0.15); ctx.lineTo(540, H * 0.27); ctx.lineTo(580, H * 0.27); ctx.closePath(); ctx.fill()
      break
    }
    case 'space': {
      ctx.fillStyle = '#030712'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      let sx = 42, sy = 17
      for (let i = 0; i < 90; i++) {
        sx = (sx * 1664525 + 1013904223) & 0xffff
        sy = (sy * 22695477 + 1) & 0xffff
        const px = (sx / 0xffff) * W
        const py = (sy / 0xffff) * H
        const r = (((sx ^ sy) & 0xf) / 0xf) * 1.4 + 0.3
        ctx.globalAlpha = 0.6 + (((sx + sy) & 0xff) / 0xff) * 0.4
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      break
    }
    case 'sunset': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#581c87'); g.addColorStop(0.3, '#db2777')
      g.addColorStop(0.6, '#ea580c'); g.addColorStop(1, '#f97316')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      const sun = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, 55)
      sun.addColorStop(0, '#fef9c3'); sun.addColorStop(0.4, '#fef08a'); sun.addColorStop(1, 'rgba(249,115,22,0)')
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#431407'; ctx.fillRect(0, H * 0.73, W, H * 0.27)
      break
    }
    case 'studio':
    default: {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#27272a'); g.addColorStop(1, '#09090b')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      const spot = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8)
      spot.addColorStop(0, 'rgba(255,255,255,0.07)'); spot.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spot; ctx.fillRect(0, 0, W, H)
    }
  }
}
