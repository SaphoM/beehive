// ---------------------------------------------------------------------------
// Screen control — inject mouse/keyboard into the window the presenter is
// sharing, so they can drive it from BeeHive's main-area preview without
// leaving the app. macOS requires Accessibility permission for input injection.
//
// Coordinate model: the renderer sends NORMALISED coords in [0,1] measured
// within the shared video's content area. We resolve the shared window's
// on-screen region via nut-js (same coordinate space as mouse.setPosition) and
// map normalised → absolute. Region is cached and refreshed on demand so the
// per-event cost stays low (no window enumeration per mouse-move).
// ---------------------------------------------------------------------------
const { systemPreferences } = require('electron')

let nut = null
function loadNut() {
  if (!nut) nut = require('@nut-tree-fork/nut-js')
  return nut
}

// Cached target: the window being controlled + its last-known region.
let target = null // { window, region: { left, top, width, height } }

// macOS Accessibility gate. Returns true if trusted; when prompt is true and
// not trusted, macOS shows the "grant Accessibility" dialog.
function isAccessibilityTrusted(prompt) {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(!!prompt)
  } catch {
    return false
  }
}

// Find the shared window by title (the desktopCapturer source name) and cache
// its region. Best-effort title match — exact first, then substring.
async function begin(title) {
  if (!isAccessibilityTrusted(true)) {
    return { ok: false, reason: 'accessibility' }
  }
  const { getWindows } = loadNut()
  try {
    const windows = await getWindows()
    const titled = await Promise.all(
      windows.map(async w => ({ w, t: (await w.getTitle().catch(() => '')) || '' }))
    )
    // Normalise: lowercase, trim, drop macOS "— Edited"/"– Edited" doc suffixes.
    const norm = s => s.toLowerCase().trim().replace(/\s*[—–-]\s*edited\s*$/i, '').trim()
    const wanted = norm(title || '')
    const candidates = titled.filter(x => x.t) // ignore untitled windows
    let match =
      candidates.find(x => norm(x.t) === wanted) ||
      (wanted && candidates.find(x => norm(x.t).includes(wanted) || wanted.includes(norm(x.t)))) ||
      // Loose token overlap fallback: share the first meaningful word.
      (wanted && candidates.find(x => {
        const a = norm(x.t).split(/[\s|—–-]+/).filter(w => w.length > 2)
        const b = wanted.split(/[\s|—–-]+/).filter(w => w.length > 2)
        return a.length && b.length && a[0] === b[0]
      }))
    if (!match) {
      return { ok: false, reason: 'window-not-found', titles: candidates.map(x => x.t).slice(0, 25) }
    }
    const region = await match.w.getRegion()
    target = { window: match.w, region }
    return { ok: true, title: match.t, region }
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message }
  }
}

async function refresh() {
  if (!target) return { ok: false, reason: 'no-target' }
  try {
    target.region = await target.window.getRegion()
    return { ok: true, region: target.region }
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message }
  }
}

function end() {
  target = null
  return { ok: true }
}

// Map normalised [0,1] within the shared window to an absolute nut-js Point.
function toPoint(nx, ny) {
  const { Point } = loadNut()
  const r = target.region
  const x = Math.round(r.left + Math.min(1, Math.max(0, nx)) * r.width)
  const y = Math.round(r.top + Math.min(1, Math.max(0, ny)) * r.height)
  return new Point(x, y)
}

// There is only ONE physical cursor. To let the presenter keep their pointer in
// the BeeHive preview (rather than having it yanked onto the shared window), we
// warp to the target only for the instant of the action, then restore the cursor
// to where it was. No continuous move-on-hover.
async function withCursorAt(point, fn) {
  const { mouse } = loadNut()
  const prev = await mouse.getPosition()
  await mouse.setPosition(point)
  await fn()
  await mouse.setPosition(prev)
}

// Kept for API compatibility; a no-op so hovering never steals the cursor.
async function move() { /* intentionally does nothing — see withCursorAt */ }

async function click(nx, ny, opts = {}) {
  if (!target) return
  const { mouse, Button } = loadNut()
  const button = opts.button === 'right' ? Button.RIGHT : opts.button === 'middle' ? Button.MIDDLE : Button.LEFT
  await withCursorAt(toPoint(nx, ny), async () => {
    if (opts.double) await mouse.doubleClick(button)
    else await mouse.click(button)
  })
}

// Wheel deltas → discrete scroll steps at the pointed-at location. Positive dy
// scrolls content down. Cursor is restored afterwards.
async function scroll(nx, ny, dx, dy) {
  if (!target) return
  const { mouse } = loadNut()
  const steps = d => Math.max(1, Math.min(12, Math.round(Math.abs(d) / 40)))
  await withCursorAt(toPoint(nx, ny), async () => {
    if (dy) { if (dy > 0) await mouse.scrollDown(steps(dy)); else await mouse.scrollUp(steps(dy)) }
    if (dx) { if (dx > 0) await mouse.scrollRight(steps(dx)); else await mouse.scrollLeft(steps(dx)) }
  })
}

async function typeText(text) {
  if (!target || !text) return
  const { keyboard } = loadNut()
  await keyboard.type(text)
}

// Press a named key, optionally with modifiers (['cmd','shift',...]).
async function pressKey(keyName, modifiers = []) {
  if (!target) return
  const { keyboard, Key } = loadNut()
  const map = {
    enter: Key.Enter, return: Key.Return, backspace: Key.Backspace, delete: Key.Delete,
    tab: Key.Tab, escape: Key.Escape, space: Key.Space,
    left: Key.Left, right: Key.Right, up: Key.Up, down: Key.Down,
    home: Key.Home, end: Key.End, pageup: Key.PageUp, pagedown: Key.PageDown,
  }
  const modMap = { cmd: Key.LeftCmd, meta: Key.LeftCmd, ctrl: Key.LeftControl, control: Key.LeftControl, alt: Key.LeftAlt, option: Key.LeftAlt, shift: Key.LeftShift }
  let k = map[(keyName || '').toLowerCase()]
  if (k === undefined && keyName && keyName.length === 1) {
    const ch = keyName.toUpperCase()
    if (ch >= 'A' && ch <= 'Z') k = Key[ch]
    else if (ch >= '0' && ch <= '9') k = Key['Num' + ch]
  }
  if (k === undefined) return
  const mods = modifiers.map(m => modMap[m]).filter(v => v !== undefined)
  await keyboard.pressKey(...mods, k)
  await keyboard.releaseKey(...mods, k)
}

module.exports = { isAccessibilityTrusted, begin, refresh, end, move, click, scroll, typeText, pressKey }
