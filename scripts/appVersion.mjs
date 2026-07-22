// Single source of truth for the app version.
//
// version = 1.0.<total-commit-count>  (e.g. a repo with 197 total commits → "1.0.197")
//
// Why commit count, not a manual bump or "number of forks": it's monotonic
// (every commit increments it, never goes backward), fully automatic (nobody
// has to remember to bump anything), and every build maps to an exact commit
// — so a version seen in the UI or an installed app can be traced straight
// back to the source it was built from. Forks are unrelated to builds and
// don't move when you ship, so they'd be a meaningless version signal.
//
// Consumed in two places, both reading from HERE so web and desktop can never
// disagree:
//   • vite.config.ts   — injects VITE_APP_VERSION / VITE_APP_SHA into the web
//                         build (shown in the footer).
//   • package.json's electron:build:* scripts — pass the value to
//     electron-builder via `-c.extraMetadata.version=$(node scripts/appVersion.mjs)`,
//     so the packaged desktop app's version matches without ever editing
//     package.json on disk (which would dirty git on every build).
//
// Run directly (`node scripts/appVersion.mjs`) it prints just the version,
// for that shell substitution.
//
// PRIMARY SOURCE: scripts/version-count.json, a plain committed file — not a
// live `git rev-list` at build time. Two real bugs, found on the actual
// deployed site rather than assumed, forced this away from computing the
// count live at build/deploy time at all:
//   1. `git rev-list --count HEAD` is branch-relative (only counts commits
//      reachable from whichever branch is checked out) — this repo's own
//      branches showed wildly different numbers for the same history (main
//      → 1, staging → 193+), so a build from the wrong branch would show a
//      nonsensical version. Switching to `--count --all` fixed this in every
//      environment that can actually walk the full ref set.
//   2. But on Render specifically, the deployed site kept showing "v1.0.1"
//      even *after* that fix shipped. Confirmed directly: the live bundle
//      contained code from commits well after the --all fix, yet still
//      reported "1.0.1" — meaning Render's build container was never
//      successfully unshallowing history at all (almost certainly restricted
//      network egress during the build step, silently swallowed by this
//      script's own try/catch), so `--count --all` on a permanently
//      depth-1-shallow checkout still only ever saw the one commit present.
// A number computed at build time is fundamentally at the mercy of however
// much git history the deploy environment happened to fetch — which varies
// by host and isn't something this repo controls. A number already baked
// into a tracked file at commit time has none of that risk: any environment,
// shallow or not, online or not, just reads a plain JSON value. The
// live-`git`-count path below is kept only as a fallback for a checkout that
// somehow lacks this file (e.g. very old history) — the committed file is
// authoritative whenever it's present, which is always, going forward.
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const git = (cmd, fallback) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback
  } catch {
    return fallback
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url))

function readCommittedCount() {
  try {
    const { count } = JSON.parse(readFileSync(join(__dirname, 'version-count.json'), 'utf8'))
    return typeof count === 'number' && count > 0 ? count : null
  } catch {
    return null
  }
}

export function getAppVersion() {
  const committed = readCommittedCount()
  if (committed != null) return `1.0.${committed}`
  // Fallback only — see the file-level comment above for why this isn't the
  // primary path. --all (every ref), not HEAD, at least stays
  // branch-independent whenever the checkout has enough history to answer.
  return `1.0.${git('git rev-list --count --all', '0')}`
}

export function getAppSha() {
  return git('git rev-parse --short HEAD', 'dev')
}

// CLI entry — print just the version (used by the electron:build:* scripts).
// Compare decoded filesystem paths, not raw URLs: this project's path
// contains a space ("X SPARK"), which is %20-encoded in import.meta.url but
// literal in process.argv[1], so a raw string compare never matches.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(getAppVersion())
}
