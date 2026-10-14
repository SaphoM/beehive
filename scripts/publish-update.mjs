#!/usr/bin/env node
// scripts/publish-update.mjs
// ---------------------------------------------------------------------------
// Run after a successful desktop build to generate update-config.json.
//
// Usage:
//   node scripts/publish-update.mjs --base-url https://releases.example.com
//
// The script reads the sha512/size values from the electron-builder YML
// manifests in release/ (latest-mac.yml, latest.yml, latest-linux.yml,
// latest-linux-arm64.yml) and writes update-config.json with full download
// URLs. Commit update-config.json to the staging branch so Render picks it up
// on the next deploy.
//
// Platform blocks are rebuilt ONLY for the platforms whose YML is present, so
// you can regenerate for one platform (e.g. Linux) without touching the
// already-published macOS/Windows entries — keeping their pinned version and
// hashes intact. A flat `downloads` list is derived from the final blocks; it
// is what the web download panel reads via GET /updates/downloads.
//
// Options:
//   --base-url   HTTPS URL prefix where the release artefacts are hosted
//   --version    Override the version (default: read from release YML)
//   --critical   Mark the update as critical (default: false)
//   --notes      Comma-separated release notes (or set multiple --notes flags)
//   --min-ver    Minimum supported version (default: 1.0.200)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')

// ── Arg parsing ─────────────────────────────────────────────────────────────

function arg(name, defaultVal = null) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return defaultVal
  return process.argv[idx + 1] ?? defaultVal
}

function flag(name) { return process.argv.includes(`--${name}`) }

function allArgs(name) {
  const vals = []
  process.argv.forEach((v, i) => {
    if (v === `--${name}`) vals.push(process.argv[i + 1])
  })
  return vals
}

const baseUrl  = arg('base-url')
const critical = flag('critical')
const minVer   = arg('min-ver', '1.0.200')
const noteArgs = allArgs('notes').flatMap(n => n.split(',').map(s => s.trim()).filter(Boolean))

if (!baseUrl) {
  console.error('Error: --base-url is required')
  console.error('Example: node scripts/publish-update.mjs --base-url https://releases.example.com')
  process.exit(1)
}

const base = baseUrl.replace(/\/$/, '')

// ── Parse a YML manifest ────────────────────────────────────────────────────

function parseYml(text) {
  const lines = text.split('\n')
  const get   = (key) => {
    const line = lines.find(l => l.trimStart().startsWith(`${key}:`))
    return line ? line.split(':').slice(1).join(':').trim().replace(/^'|'$/g, '') : null
  }
  const files = []
  let inFiles = false
  let cur     = {}
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === 'files:') { inFiles = true; continue }
    if (inFiles) {
      if (line.startsWith('  - url:')) { if (cur.url) files.push(cur); cur = { url: line.replace('  - url:', '').trim() }; continue }
      if (line.startsWith('    sha512:')) { cur.sha512 = line.replace('    sha512:', '').trim(); continue }
      if (line.startsWith('    size:'))   { cur.size   = parseInt(line.replace('    size:', '').trim(), 10); continue }
      if (!line.startsWith(' ') && !line.startsWith('\t')) { if (cur.url) files.push(cur); inFiles = false }
    }
  }
  if (cur.url) files.push(cur)
  return { version: get('version'), releaseDate: get('releaseDate'), files }
}

function readYml(name) {
  const p = join(ROOT, 'release', name)
  return existsSync(p) ? parseYml(readFileSync(p, 'utf8')) : null
}

// Derive the published filename from a full download URL.
const fileOf = (url) => (url ? url.split('/').pop() : null)

// ── Read generated manifests (any subset may be present) ────────────────────

const mac        = readYml('latest-mac.yml')
const win        = readYml('latest.yml')
const linuxX64   = readYml('latest-linux.yml')
const linuxArm64 = readYml('latest-linux-arm64.yml')

const outPath  = join(ROOT, 'update-config.json')
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null

if (!mac && !win && !linuxX64 && !existing) {
  console.error('Error: no release/*.yml manifests and no update-config.json found.')
  console.error('Run a desktop build first: npm run electron:build:linux (or :mac / :win)')
  process.exit(1)
}

// Version/releaseDate track the macOS/Windows feed (the pinned blocks) so
// refreshing just Linux never rewrites what existing mac/win users are offered.
// The Linux feed carries its own version inside config.linux.version.
const version     = arg('version') || mac?.version || existing?.version || win?.version || linuxX64?.version
const releaseDate = mac?.releaseDate || existing?.releaseDate || linuxX64?.releaseDate || new Date().toISOString()

// ── Rebuild only the platform blocks we have fresh manifests for ────────────
// (Anything we don't have stays exactly as it was in update-config.json, so
// regenerating for Linux never rewrites the pinned macOS/Windows entries.)

function macBlock() {
  if (!mac) return existing?.mac
  // The first file in latest-mac.yml is typically the .zip; the second is the .dmg
  const zip = mac.files.find(f => f.url.endsWith('.zip')) || mac.files[0]
  const dmg = mac.files.find(f => f.url.endsWith('.dmg'))
  return {
    url:    `${base}/${zip.url}`,
    sha512: zip.sha512,
    size:   zip.size,
    ...(dmg ? { dmgUrl: `${base}/${dmg.url}`, dmgSha512: dmg.sha512, dmgSize: dmg.size } : {}),
  }
}

function winBlock() {
  if (!win) return existing?.win
  const all   = win.files.find(f => f.url === 'BeeHive-Setup.exe') || win.files[0]
  const x64   = win.files.find(f => f.url === 'BeeHive-Setup-x64.exe')
  const arm64 = win.files.find(f => f.url === 'BeeHive-Setup-arm64.exe')
  return {
    url:    `${base}/${all.url}`,
    sha512: all.sha512,
    size:   all.size,
    ...(x64   ? { x64Url: `${base}/${x64.url}`, x64Sha512: x64.sha512, x64Size: x64.size } : {}),
    ...(arm64 ? { arm64Url: `${base}/${arm64.url}`, arm64Sha512: arm64.sha512, arm64Size: arm64.size } : {}),
  }
}

const pick = (yml, name) => yml?.files.find(f => f.url === name)

function linuxBlock() {
  if (!linuxX64) return existing?.linux
  const appImage = pick(linuxX64, 'BeeHive-x86_64.AppImage')
  const deb      = pick(linuxX64, 'BeeHive-amd64.deb')
  const rpm      = pick(linuxX64, 'BeeHive-x86_64.rpm')
  const aAppImage = pick(linuxArm64, 'BeeHive-arm64.AppImage')
  const aDeb      = pick(linuxArm64, 'BeeHive-arm64.deb')
  const aRpm      = pick(linuxArm64, 'BeeHive-aarch64.rpm')
  const entry = (f, key) => (f ? {
    [`${key}Url`]:    `${base}/${f.url}`,
    [`${key}Sha512`]: f.sha512,
    [`${key}Size`]:   f.size,
  } : {})
  return {
    // electron-updater for Linux requests /updates/latest-linux.yml; the app
    // version there must track the AppImage actually published, which can be
    // newer than the pinned macOS/Windows feed (see backend latest-linux.yml).
    version: linuxX64.version,
    releaseDate: linuxX64.releaseDate,
    url:    `${base}/${appImage.url}`,
    sha512: appImage.sha512,
    size:   appImage.size,
    ...entry(deb, 'deb'),
    ...entry(rpm, 'rpm'),
    ...(aAppImage ? { arm64Url: `${base}/${aAppImage.url}`, arm64Sha512: aAppImage.sha512, arm64Size: aAppImage.size } : {}),
    ...entry(aDeb, 'arm64Deb'),
    ...entry(aRpm, 'arm64Rpm'),
  }
}

const config = {
  version,
  releaseDate,
  critical,
  minimumVersion: minVer,
  notes: noteArgs.length > 0 ? noteArgs : (existing?.notes ?? ['Performance and reliability improvements']),
  ...(macBlock()    ? { mac: macBlock() }       : {}),
  ...(winBlock()    ? { win: winBlock() }       : {}),
  ...(linuxBlock()  ? { linux: linuxBlock() }   : {}),
}

// ── Flat download manifest for the web download panel ───────────────────────
// Every entry the panel can offer, keyed by the exact published filename.

function collect() {
  const out = []
  const add = (os, arch, format, url, size) => {
    const file = fileOf(url)
    if (file && size) out.push({ os, arch, format, file, url, size })
  }
  const m = config.mac
  if (m?.dmgUrl) add('mac', 'universal', 'dmg', m.dmgUrl, m.dmgSize)
  const w = config.win
  if (w) add('windows', 'universal', 'exe', w.url, w.size)
  const l = config.linux
  if (l) {
    add('linux', 'x64',   'AppImage', l.url, l.size)
    add('linux', 'x64',   'deb',      l.debUrl, l.debSize)
    add('linux', 'x64',   'rpm',      l.rpmUrl, l.rpmSize)
    add('linux', 'arm64', 'AppImage', l.arm64Url, l.arm64Size)
    add('linux', 'arm64', 'deb',      l.arm64DebUrl, l.arm64DebSize)
    add('linux', 'arm64', 'rpm',      l.arm64RpmUrl, l.arm64RpmSize)
  }
  return out
}
config.downloads = collect()

writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n')
console.log(`✓ update-config.json written for v${version}`)
if (config.mac)   console.log(`  macOS   → ${config.mac.url}`)
if (config.win)   console.log(`  Windows → ${config.win.url}`)
if (config.linux) console.log(`  Linux   → ${config.linux.url}  (+deb, +rpm, +arm64)`)
console.log(`  Downloads manifest: ${config.downloads.length} artifact(s)`)
console.log('  Critical:', critical)
if (noteArgs.length) console.log('  Notes:', noteArgs)
console.log('\nNext steps:')
console.log('  1. Upload the release/ artefacts to', base)
console.log('  2. Commit update-config.json to staging')
console.log('  3. Push — Render redeploys and the update feed goes live')
