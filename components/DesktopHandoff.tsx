// ============================================================
// DESKTOP HANDOFF — web → desktop app sign-in bridge  (STUB)
// ============================================================
// Purpose: when a user completes sign-in on the WEB (via the Supabase magic
// link) but also has the BeeHive desktop app installed, offer to continue in
// the desktop app by handing the authenticated session across the `beehive://`
// deep link (parsed by electron/main.cjs → handleDeepLink).
//
// STATUS: stubbed and DISABLED. Wire it up later by flipping ENABLE_DESKTOP_HANDOFF.
// It is intentionally optional — a user who just wants the web keeps using the
// web (see point 2 of the auth plan). Nothing here ever force-redirects.
//
// TODO (when activating):
//   [ ] Decide how to *offer* the handoff — a manual "Open in BeeHive desktop"
//       button is the reliable path; browsers cannot silently detect an installed
//       app. Optionally remember a "prefers desktop" choice in localStorage.
//   [ ] Confirm electron/main.cjs handleDeepLink consumes the token hash below and
//       calls supabase.auth.setSession (or relies on detectSessionInUrl). Align the
//       hash param names with whatever the desktop side reads.
//   [ ] Register the beehive:// scheme handling end-to-end (already declared via
//       app.setAsDefaultProtocolClient('beehive') in main.cjs).
//   [ ] Add a short fallback timer: if the app doesn't take focus, stay on web.
//   [ ] Gate production vs staging if the rollout should differ.

import type { Session } from '@supabase/supabase-js'

// Master switch. Leave false until the flow above is finished and tested.
export const ENABLE_DESKTOP_HANDOFF = false

// True only in a real browser (never inside the Electron renderer, which is
// already the desktop app and has no one to hand off to).
export function canOfferDesktopHandoff(): boolean {
  if (!ENABLE_DESKTOP_HANDOFF) return false
  if (typeof window === 'undefined') return false
  if ((window as unknown as { electronAPI?: unknown }).electronAPI) return false
  return true
}

// Build the deep link that opens the desktop app with the given session.
// Tokens live in the URL *hash* so they are never sent to a server or captured
// in server access logs — same reasoning as the web auth-callback flow.
export function buildDesktopHandoffUrl(session: Session): string {
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    type: 'magiclink',
  }).toString()
  return `beehive://auth/confirm#${hash}`
}

// STUB trigger — no-op until enabled. Kept as the single entry point so callers
// don't need to change when the flow is activated.
export function openInDesktopApp(session: Session): void {
  if (!canOfferDesktopHandoff()) return
  // TODO: window.location.href = buildDesktopHandoffUrl(session)
  //       then start a fallback timer that clears any "opening…" UI.
}

// Post-login prompt shown on the web offering to continue in the desktop app.
// Renders nothing while the feature is disabled, so it is safe to mount today.
export function DesktopHandoffPrompt(_props: { session?: Session | null }): null {
  if (!canOfferDesktopHandoff()) return null
  // TODO: render a dismissible "Open in BeeHive desktop app" card that calls
  //       openInDesktopApp(session). Until then this branch is unreachable.
  return null
}
