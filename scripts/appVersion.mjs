// Single source of truth for the app version, derived automatically from git.
//
// version = 1.0.<total-commit-count>  (e.g. commit #188 → "1.0.188")
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

export function getAppVersion() {
  return `1.0.${git('git rev-list --count HEAD', '0')}`
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
