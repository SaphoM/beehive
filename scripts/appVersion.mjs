// Single source of truth for the app version, derived automatically from git.
//
// version = 1.0.<total-commit-count>  (e.g. a repo with 193 total commits → "1.0.193")
// Counted with --all (every ref, not just HEAD) so every branch reports the
// same number for the same repository — see ensureFullHistory below and the
// README's "Branch-relative undercount, fixed" note for why this matters.
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
// for that shell substitution. Falls back to 1.0.0 outside a git checkout
// (e.g. a source tarball) so a build never hard-fails over versioning.
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const git = (cmd, fallback) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback
  } catch {
    return fallback
  }
}

// Hosted build environments (confirmed on Render, which builds from a
// shallow `git clone --depth 1`) only fetch the single tip commit — `git
// rev-list --count HEAD` doesn't error in that case, it just silently walks
// the sliver of history that's actually present and returns 1. That shipped
// to production as "v1.0.1" instead of the real commit count (~189+ at the
// time), with no warning anywhere that anything was wrong. Detect a shallow
// checkout and unshallow it once before counting, so the version reflects
// the repo's true, full history regardless of how the build environment
// cloned it. Memoized so a build that calls getAppVersion() more than once
// (vite.config.ts does, alongside getAppSha()) only attempts this once.
let unshallowed = false
function ensureFullHistory() {
  if (unshallowed) return
  unshallowed = true
  if (git('git rev-parse --is-shallow-repository', 'false') !== 'true') return
  try {
    // Needs network + an `origin` remote — both present on every hosted CI
    // clone from GitHub. If this fails (e.g. no network, detached from any
    // remote), fall through and count whatever history is actually present
    // rather than hard-failing the build over a version string.
    execSync('git fetch --unshallow --quiet', { stdio: 'ignore' })
  } catch { /* best effort — see comment above */ }
}

export function getAppVersion() {
  ensureFullHistory()
  // --all (every ref: every local/remote branch, every tag), not HEAD — HEAD
  // only counts commits reachable from whichever branch happens to be
  // checked out, so main/staging/develop/feature branches each produced a
  // different, branch-relative number for the same repository (confirmed:
  // main showed 1, staging 193, develop 20 — a build from main would have
  // shown "v1.0.1", a nonsensical downgrade from staging's "v1.0.193", even
  // though both are the same repo at nearly the same point in time). --all
  // counts the total number of unique commits across the whole repo instead,
  // so the same commit history produces the same version number no matter
  // which branch a build happens to run from.
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
