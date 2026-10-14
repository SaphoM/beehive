#!/usr/bin/env node
// scripts/linux-checksums.mjs
// ---------------------------------------------------------------------------
// Write release/SHA256SUMS-linux.txt covering every Linux installer produced by
// `npm run electron:build:linux`. Upload it alongside the artifacts so users
// can verify a download before running it:
//
//   sha256sum -c SHA256SUMS-linux.txt
//
// The per-file sha512 the updater uses already lives in latest-linux*.yml; this
// is the human-facing checksum file for manual installs.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')

const isLinuxArtifact = (name) =>
  /^BeeHive-(x86_64|aarch64|amd64|arm64)\.(AppImage|deb|rpm)$/.test(name)

let names
try {
  names = readdirSync(RELEASE).filter(isLinuxArtifact).sort()
} catch {
  console.error('Error: release/ not found — run npm run electron:build:linux first.')
  process.exit(1)
}

if (names.length === 0) {
  console.error('Error: no Linux installers found in release/.')
  process.exit(1)
}

const lines = names.map((name) => {
  const p = join(RELEASE, name)
  const hash = createHash('sha256').update(readFileSync(p)).digest('hex')
  const size = statSync(p).size
  console.log(`  ${hash}  ${name}  (${(size / 1024 / 1024).toFixed(0)} MB)`)
  return `${hash}  ${name}`
})

const outPath = join(RELEASE, 'SHA256SUMS-linux.txt')
writeFileSync(outPath, lines.join('\n') + '\n')
console.log(`\n✓ ${names.length} Linux installer(s) hashed → release/SHA256SUMS-linux.txt`)
