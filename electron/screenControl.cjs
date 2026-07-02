// ---------------------------------------------------------------------------
// Screen control — drive the window the presenter is sharing from BeeHive's
// main-area preview, without leaving the app.
//
// Primary engine: the native `beehive-ctl` helper (electron/beehive-ctl.m),
// which posts events DIRECTLY to the target app's process (CGEventPostToPid):
//   • the physical cursor never moves (no bouncing / no warp flicker)
//   • the shared window responds even while BEHIND the BeeHive window
//   • BeeHive keeps focus, so the meeting controls stay fully usable
// The helper is compiled on demand in dev (clang, needs Xcode CLT) and shipped
// via extraResources in packaged builds.
//
// Fallback engine: nut-js absolute cursor injection (used if the helper binary
// is unavailable — e.g. no compiler on the machine). Its clicks land on
// whatever window is frontmost at that point, so it only works when the shared
// window is visible; the helper is strongly preferred.
//
// Coordinate model: the renderer sends NORMALISED coords in [0,1] within the
// shared video's content area; both engines map them to the window's on-screen
// bounds (the helper re-reads bounds per action, so moved windows stay accurate).
// macOS requires Accessibility permission for input injection either way.
// ---------------------------------------------------------------------------
const { systemPreferences } = require('electron')
const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// ---------- permission ----------
function isAccessibilityTrusted(prompt) {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.isTrustedAccessibilityClient(!!prompt)
  } catch {
    return false
  }
}

// ---------- native helper engine ----------
let helper = null // { proc, buf, queue }

function helperBinaryPath() {
  // Packaged app: shipped via mac.extraResources
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'beehive-ctl')
    if (fs.existsSync(packaged)) return packaged
  }
  // Dev: compile from source on demand (and recompile when the source changes)
  const src = path.join(__dirname, 'beehive-ctl.m')
  const bin = path.join(__dirname, 'bin', 'beehive-ctl')
  try {
    const stale = !fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs
    if (stale) {
      fs.mkdirSync(path.dirname(bin), { recursive: true })
      execFileSync('clang', ['-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-o', bin, src], { stdio: 'ignore' })
    }
  } catch { /* no compiler — fall through to whatever exists */ }
  return fs.existsSync(bin) ? bin : null
}

function startHelper() {
  const bin = helperBinaryPath()
  if (!bin) return null
  try {
    const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    const session = { proc, buf: '', queue: [] }
    proc.stdout.on('data', d => {
      session.buf += d.toString()
      let i
      while ((i = session.buf.indexOf('\n')) >= 0) {
        const line = session.buf.slice(0, i)
        session.buf = session.buf.slice(i + 1)
        const resolve = session.queue.shift()
        if (resolve) {
          try { resolve(JSON.parse(line)) } catch { resolve({ ok: false, reason: 'bad-json' }) }
        }
      }
    })
    proc.on('exit', () => { if (helper === session) helper = null })
    return session
  } catch {
    return null
  }
}

function helperSend(cmd) {
  if (!helper) return Promise.resolve({ ok: false, reason: 'no-helper' })
  return new Promise(resolve => {
    helper.queue.push(resolve)
    try { helper.proc.stdin.write(JSON.stringify(cmd) + '\n') } catch { resolve({ ok: false, reason: 'write-failed' }) }
  })
}

function stopHelper() {
  if (helper) { try { helper.proc.kill() } catch {} }
  helper = null
}

// ---------- nut-js fallback engine ----------
let nut = null
function loadNut() {
  if (!nut) nut = require('@nut-tree-fork/nut-js')
  return nut
}

let nutTarget = null // { window, region }

async function nutBegin(title) {
  const { getWindows } = loadNut()
  const windows = await getWindows()
  const titled = await Promise.all(windows.map(async w => ({ w, t: (await w.getTitle().catch(() => '')) || '' })))
  const norm = s => s.toLowerCase().trim().replace(/\s*[—–-]\s*edited\s*$/i, '').trim()
  const wanted = norm(title || '')
  const candidates = titled.filter(x => x.t)
  const match =
    candidates.find(x => norm(x.t) === wanted) ||
    (wanted && candidates.find(x => norm(x.t).includes(wanted) || wanted.includes(norm(x.t))))
  if (!match) return { ok: false, reason: 'window-not-found', titles: candidates.map(x => x.t).slice(0, 25) }
  nutTarget = { window: match.w, region: await match.w.getRegion() }
  return { ok: true, title: match.t }
}

function nutPoint(nx, ny) {
  const { Point } = loadNut()
  const r = nutTarget.region
  return new Point(
    Math.round(r.left + Math.min(1, Math.max(0, nx)) * r.width),
    Math.round(r.top + Math.min(1, Math.max(0, ny)) * r.height)
  )
}

// ---------- public API (helper first, nut fallback) ----------
let engine = null // 'helper' | 'nut' | null

async function begin(title) {
  if (!isAccessibilityTrusted(true)) return { ok: false, reason: 'accessibility' }
  end() // reset any previous session

  helper = startHelper()
  if (helper) {
    const res = await helperSend({ cmd: 'find', title: title || '' })
    if (res.ok) { engine = 'helper'; return res }
    stopHelper()
    // fall through — maybe nut sees the window differently
    try {
      const nres = await nutBegin(title)
      if (nres.ok) { engine = 'nut'; return nres }
      return res.titles?.length ? res : nres
    } catch (e) {
      return res.reason ? res : { ok: false, reason: 'error', message: e.message }
    }
  }

  try {
    const res = await nutBegin(title)
    if (res.ok) engine = 'nut'
    return res
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message }
  }
}

function end() {
  stopHelper()
  nutTarget = null
  engine = null
  return { ok: true }
}

async function refresh() {
  if (engine === 'nut' && nutTarget) {
    try { nutTarget.region = await nutTarget.window.getRegion(); return { ok: true } } catch (e) { return { ok: false, message: e.message } }
  }
  return { ok: engine === 'helper' } // helper re-reads bounds on every action
}

async function move(nx, ny) {
  if (engine === 'helper') { await helperSend({ cmd: 'move', nx, ny }); return }
  if (engine === 'nut' && nutTarget) {
    const { mouse } = loadNut()
    await mouse.setPosition(nutPoint(nx, ny))
  }
}

async function click(nx, ny, opts = {}) {
  if (engine === 'helper') {
    await helperSend({ cmd: 'click', nx, ny, button: opts.button || 'left', double: !!opts.double })
    return
  }
  if (engine === 'nut' && nutTarget) {
    const { mouse, Button } = loadNut()
    const button = opts.button === 'right' ? Button.RIGHT : opts.button === 'middle' ? Button.MIDDLE : Button.LEFT
    await mouse.setPosition(nutPoint(nx, ny))
    if (opts.double) await mouse.doubleClick(button)
    else await mouse.click(button)
  }
}

async function scroll(nx, ny, dx, dy) {
  if (engine === 'helper') { await helperSend({ cmd: 'scroll', nx, ny, dx, dy }); return }
  if (engine === 'nut' && nutTarget) {
    const { mouse } = loadNut()
    const steps = d => Math.max(1, Math.min(12, Math.round(Math.abs(d) / 40)))
    await mouse.setPosition(nutPoint(nx, ny))
    if (dy) { if (dy > 0) await mouse.scrollDown(steps(dy)); else await mouse.scrollUp(steps(dy)) }
    if (dx) { if (dx > 0) await mouse.scrollRight(steps(dx)); else await mouse.scrollLeft(steps(dx)) }
  }
}

async function typeText(text) {
  if (!text) return
  if (engine === 'helper') { await helperSend({ cmd: 'type', text }); return }
  if (engine === 'nut' && nutTarget) {
    const { keyboard } = loadNut()
    await keyboard.type(text)
  }
}

async function pressKey(keyName, modifiers = []) {
  if (engine === 'helper') { await helperSend({ cmd: 'key', key: keyName, mods: modifiers }); return }
  if (engine === 'nut' && nutTarget) {
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
}

module.exports = { isAccessibilityTrusted, begin, refresh, end, move, click, scroll, typeText, pressKey }
