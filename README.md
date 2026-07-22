# BEEHIVE
**X Spark Video Conferencing Platform**

> Real-time video meetings powered by LiveKit and Supabase.

---

## Overview

BeeHive is X Spark's video conferencing product. It supports two modes selectable from the lobby:

- **Meet** — standard video meetings
- **Sting** — alternative session mode

Built for scale: designed around the DUT (Durban University of Technology) use case of 50–200 concurrent users per lecture room.

Available as a **web app** and a **native desktop app** (Electron, macOS / Windows).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8 |
| Video/Audio | LiveKit Cloud |
| Noise suppression | Krisp (`@livekit/krisp-noise-filter`) — background-noise filtering on the mic, lazy-loaded |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime subscriptions |
| Auth | Supabase Auth — Magic Link + Email OTP (no passwords) |
| Icons | Lucide React |
| Fonts | Roboto (Google Fonts) — Thin (100) / Light (300) / Regular (400) |
| Backend | Node.js + Express 5 |
| Meeting Intelligence | Fathom API |
| Background AI | MediaPipe Tasks Vision `ImageSegmenter` (GPU-delegated), with the legacy MediaPipe Selfie Segmentation API as an automatic fallback — see `components/segmentation/` |
| Desktop | Electron 42 + electron-builder |
| Window activation | `beehive-ctl` native helper (`NSRunningApplication`) — bring the shared window's app to the foreground |
| Dock click routing | `beehive-ctl watch-clicks` — hardware button-state poll (`CGEventSourceButtonState`), no permission required; lets the click-through Floating Control Dock stay clickable without ever dropping a full-screen presentation |

---

## Features

### Authentication

BeeHive uses **passwordless auth** — no passwords, ever.

| Flow | How it works |
|------|-------------|
| **Magic link** | Enter email → click link in email → signed in (web default) |
| **6-digit OTP** | Enter email → receive code → type code in app (Electron default; also available on web) |
| **Frictionless room join** | `?room=ID` links bypass auth entirely — guests join directly |
| **Post-meeting register** | Guests who joined via room link are prompted to **request Beta access** after the meeting ends (card-flip animation in lobby) |

**Private Beta — access is invite-only:** BeeHive is in a private Beta, so accounts are **provisioned by X Spark** rather than self-served. The **Register** control (both on the `AuthScreen` and the lobby's post-meeting `RegisterPanel`) is tagged with a **`Beta`** badge and, instead of creating an account, opens a pre-filled `mailto:studio@xspark.co.za` "Request access from X Spark" message. Sign-in for existing accounts (magic link / OTP) is unchanged. The request-access email + `mailto` are defined once in `components/roomUtils.ts` (`REQUEST_ACCESS_EMAIL`, `REQUEST_ACCESS_MAILTO`) and shared by both surfaces.

**Roles:**

| Role | Who |
|------|-----|
| `admin` | sapho@xspark.co.za |
| `user` | All other team members |

Admin role is assigned automatically by the seed script. Users provisioned during the Beta get the `user` role via a Supabase trigger on `auth.users`. Both **seed users** (assigned by the seed script) and **fully registered users** (with a `user` role) are "authenticated" — they hold a Supabase session, which is what gates access to the desktop-app handoff/download below (invite-link guests hold no session and don't see it).

**Auth gate:** The `AuthGate` component wraps the entire app. `?room=` links skip the gate; all other routes require a session.

**Session persistence:** Sessions are stored in `localStorage` and survive page reloads. Default expiry: 1 week.

**Electron deep-link:** Magic links redirect to `beehive://auth/confirm#token=…`. Electron intercepts the URL scheme, extracts the token from the hash, and loads it into the renderer so Supabase can establish the session automatically.
- `handleDeepLink` (`electron/main.cjs`) forwards **both** the query string and the hash into the app's `auth=confirm` route — a link that comes back as `?code=…` (PKCE) is just as valid as one with `#access_token=…` (implicit)
- The Supabase client (`livekit_react_hooks.tsx`) pins `flowType: 'implicit'`. PKCE's `?code` must be exchanged using a verifier stored by the *same app instance* that requested it — but the desktop handoff opens a different instance (or a different app entirely) than the one that sent the link, so that exchange can't succeed there. Implicit-flow tokens are self-contained and any instance can consume them via `setSession`, which is what `AuthGate`/`DesktopHandoff` already do
- **The packaged app registers the `beehive://` scheme itself** (`build.protocols` in `package.json` → `CFBundleURLTypes` in the built Info.plist), so the link opens the **installed native app**, not whichever dev Electron instance happens to be running
- **Critical, easy to miss:** none of the above matters unless `beehive://**` (or at least `beehive://auth/confirm`) is added to Supabase's **Auth → URL Configuration → Redirect URLs** allowlist. Supabase validates `emailRedirectTo`/`options.redirect_to` server-side and **silently substitutes the Site URL** if the requested redirect isn't allow-listed — so the email link looks fine but always lands back on the web app, never the desktop app, and the desktop sign-in screen never resolves. Confirmed via `POST /auth/v1/admin/generate_link` — even with `redirect_to: "beehive://auth/confirm"` explicitly requested, the response's `redirect_to` came back as the Site URL until this allowlist entry exists
- **OTP code length:** this project's Auth settings issue an **8-digit** email OTP (confirmed via the same `generate_link` call — `email_otp` is consistently 8 characters), not the commonly-assumed 6-digit default. The OTP `<input>` in `AuthScreen.tsx` matches this (`maxLength={8}`) — if you ever regenerate this screen from a template, check the actual OTP length in Supabase's Auth settings rather than assuming 6

**Web → Desktop sign-in handoff** (`components/DesktopHandoff.tsx`): an **"Open in desktop app"** button on the web lobby lets a signed-in web user continue in the BeeHive desktop app without re-entering their email:
- **Authenticated users only** — the whole handoff/download block (`OpenDesktopAppButton`) renders nothing unless there's a Supabase session (`if (!session) return null`), so it's shown only to **seed users and fully registered users**, never to invite-link guests
- Clicking it navigates to `beehive://auth/confirm#access_token=…&refresh_token=…` — the desktop app picks up the hash and establishes the same session (`AuthGate` calls `supabase.auth.setSession(...)` explicitly, so it doesn't depend on Supabase's automatic `detectSessionInUrl`)
- **Meeting invites carry through** — if the web page's URL has a `?room=ID` invite when the button is clicked, it's added to the deep link's *query* (`beehive://auth/confirm?room=ID#tokens`), so the desktop app opens **into the same meeting's join preview** rather than dropping the user in the lobby (an earlier version dropped the room here, so continuing to desktop from an invite lost the invite entirely). The query and hash play different roles by design: `handleDeepLink` (`electron/main.cjs`) forwards all query params to the renderer verbatim — where `RoomPage` reads `?room=` on mount exactly as it does on the web — while the hash stays reserved for auth tokens
  - **Two real races were dropping this silently, even with the query forwarded correctly.** The handoff URL is `beehive://auth/confirm?room=ID#access_token=...&type=magiclink` — Supabase's client (`detectSessionInUrl: true`) auto-detects that hash and, once it's consumed the tokens, cleans up the URL via `history.replaceState` **asynchronously**, independently of and racing with `AuthGate`'s own explicit `setSession()` call.
    1. **`RoomPage`'s `?room=` read was a `useEffect` that only fires once the component mounts** — which only happens after `AuthGate` resolves the whole auth callback (spinner → `callbackSettled`). By then, Supabase's own URL cleanup had frequently already stripped `room` from the query, so the effect read nothing. Fixed by capturing it **synchronously at module-evaluation time** instead (`INITIAL_ROOM_ID_FROM_URL` in `RoomPage.tsx`) — JS guarantees every synchronous top-level module body across the whole import graph finishes running before the event loop yields to any microtask/timer, including whatever async work Supabase's `detectSessionInUrl` kicks off, so this is captured before that race can even begin, regardless of import order.
    2. **The deeper bug, in `AuthGate.tsx` itself**: `hasRoomParam()` was called fresh in the render body every render — unlike `isAuthCallback()` right next to it, which was already correctly cached once via `useState`. If `AuthGate` re-rendered for *any* reason after Supabase's async cleanup ran (guaranteed to happen at least once, as `loading` settles), `hasRoomParam()` now read the already-stripped URL, returned `false`, and **AuthGate swapped the entire child tree for the sign-in screen** instead of ever reaching `RoomPage` — regardless of whether `RoomPage`'s own capture was already fixed. This was the actual root cause. Fixed with the same `useState(hasRoomParam)` caching pattern `isAuthCallback` already used.
    - Verified directly: simulated the exact race with a headless browser (strip the URL via `history.replaceState` at a controlled delay after load) against the production build. Confirmed the pre-fix code failed and the post-fix code succeeds at realistic timing — measured first-meaningful-paint at ~570ms in the test harness, and Supabase's own async session/token processing only starts after that, so a ~800ms real-world race window is representative; both fixes hold at that timing
- Tokens travel in the URL **hash**, never sent to a server or logged
- If the desktop app isn't installed, the OS silently ignores the `beehive://` navigation — nothing breaks
- Only rendered in a real browser — it never appears inside the Electron app itself (`canOfferDesktopHandoff()` checks for `window.electronAPI`)

**Download the desktop app:** directly beneath the button, a small OS-aware **"Don't have it? Download for macOS / Windows"** link is shown to authenticated visitors on a real Mac or Windows desktop browser — it senses the visitor's OS and downloads the matching native installer, no manual picking required:
- OS is detected via `detectDesktopOS()` — checks `navigator.platform`/`userAgent`, and excludes touch-primary devices (`matchMedia('(pointer: coarse)')`) so phones and tablets never see a desktop-app download link — this specifically also excludes **iPadOS**, which reports `navigator.platform` as `"MacIntel"` when the device requests the desktop site, and would otherwise be misidentified as a Mac
- **Both platforms ship their native installer directly** — each link points at a **direct-download asset URL on a GitHub Release** (`NATIVE_MAC_DMG_URL` / `NATIVE_WIN_EXE_URL` in `DesktopHandoff.tsx`), not the Releases *page*, so clicking it starts the download immediately with no click-through:
  - **macOS** → `BeeHive-universal.dmg` — a genuine universal binary (Apple Silicon + Intel in one installer, `lipo`-merged by `@electron/universal` via electron-builder's `--universal` flag). One download link for every Mac; no OS-side architecture branching needed
  - **Windows** → `BeeHive-Setup.exe` — a combined multi-arch NSIS installer (x64 + arm64 in one file, `package.json`'s `electron:build:win` runs `electron-builder --win --x64 --arm64`, which builds both and also produces per-arch `BeeHive-Setup-x64.exe`/`BeeHive-Setup-arm64.exe` alongside it — only the combined one is linked from the UI). Detects the machine's actual architecture at install time and installs the matching payload, same "one download, works everywhere" property as the macOS universal `.dmg`. Verified by size, not assumed: the combined installer is ~222MB, matching the sum of the two per-arch payloads (~115MB + ~108MB) rather than just one of them.
    - **Root cause this replaced**: `electron:build:win` previously had no explicit arch flag at all, so electron-builder defaulted to the *build machine's own* architecture — since builds have only ever run on this Apple Silicon Mac, every published Windows installer was silently an **arm64** `.exe` (confirmed by actually running the old script and inspecting the output: `archs=arm64`, filename `BeeHive-Setup-arm64.exe`), while the web UI linked to a `BeeHive-Setup-x64.exe` that was never actually being produced by a plain `npm run electron:build:win` — the correct x64 asset published on GitHub today only exists because an earlier build happened to pass `--x64` manually. Adding `--x64 --arm64` explicitly means the correct architectures are produced by default, every time, without anyone needing to remember a flag.
    - **A second, unrelated defect found during this same audit**: `package.json`'s `build.win.icon` pointed at `assets/icon.ico`, which never existed in the repo (only the macOS `assets/icon.icns` did) — every Windows build was silently shipping with the generic default Electron icon instead of BeeHive's branding (visible in the build log as `default Electron icon is used`). Generated a real multi-resolution `.ico` (`16`–`256px`) from the existing `.icns`'s highest-resolution source image (`iconutil -c iconset` to extract PNGs, then Pillow to re-encode as `.ico`) — confirmed via `file` that it's a valid multi-size Windows icon resource, and confirmed the warning no longer appears on rebuild.
  - These installers are 100MB+ (over GitHub's 100MB per-file git limit), which is why they're published as release assets rather than committed to the repo
  - **Stable, version-less filenames on GitHub's `latest` release alias** — all URLs above resolve via `releases/latest/download/<name>`, which always serves whatever asset with that exact name is attached to the most recently published release. `package.json`'s `build.mac.artifactName` / `build.win.artifactName` emit exactly these fixed names for the per-arch builds (no version baked into the filename); the combined Windows installer's `BeeHive-Setup.exe` name is electron-builder's own fixed convention for a multi-arch NSIS build, not from that template. The old scheme (`BeeHive-1.0.0-arm64.dmg`, tied to a specific version tag) went stale on every version bump and needed the download URL hand-edited in `DesktopHandoff.tsx` each time — these URLs never need to change again.
  - To publish a new build: `npm run electron:build:mac` and `npm run electron:build:win` (each now builds both architectures for its platform automatically — `--universal` for mac, `--x64 --arm64` for Windows — no manual flag needed), then `gh release upload latest release/<file> --clobber` to replace the asset on the `latest`-aliased release in place — the download URL never needs touching.
  - **The published asset can lag behind the current build** — the download URL is a fixed release-asset link, so the web app always serves whatever installer was last uploaded, *not* what's on disk. Re-run the `gh release upload … --clobber` step whenever a rebuild should reach downloaders. (`gh` must be authenticated — `gh auth login` — before this works; the upload publishes a public asset.)
  - **First-launch bypass is surfaced in the UI** — because these installers are only ad-hoc code-signed (no paid Apple Developer ID / Windows publisher cert — see the macOS code-signing note under *Building a distributable*), a downloaded app is blocked on first open by Gatekeeper ("cannot verify developer") / SmartScreen. `DesktopHandoff.tsx` shows a one-line hint under the download link telling the user the one-time bypass (macOS: right-click → Open; Windows: More info → Run anyway) so **install actually completes** rather than dead-ending at that dialog. Truly frictionless (double-click) install would require a paid Apple Developer ID + notarization, which this project does not have
  - Override either with a differently-hosted binary via `VITE_DESKTOP_DOWNLOAD_MAC_URL` / `VITE_DESKTOP_DOWNLOAD_WIN_URL`

**Supabase URL configuration (required for production):**
- Site URL → `https://beehive-fu8w.onrender.com`
- Redirect URLs → `https://beehive-fu8w.onrender.com/**`, `http://localhost:5173/**`, **`beehive://**`** (required for the desktop magic-link handoff — see the callout above; without this entry the desktop sign-in link never resolves)

---

### Invitations

Anyone in a meeting can invite anyone else — no account required on either side.

**Flow:**
1. Click **Link** (🔗) in the controls bar → `InviteModal` opens
2. The plain `?room=ROOM_ID` link is shown — click the link box or **Copy link** to copy it
3. Share the link with anyone (chat, email, Slack, etc.)
4. Recipient clicks it → goes straight to the lobby; no account required to join

> The same `?room=ROOM_ID` link is used whether the host is authenticated or a guest.

---

### Lobby

- **BEE**HIVE wordmark — `BEE` in Roboto Regular (400), `HIVE` in Roboto Thin (100)
- **Fixed-width card** (`roomStyles.ts`'s `lobbyCard`, `width: 400` + `boxSizing: 'border-box'`) — the lobby/schedule card has a fixed width, not just a `minWidth`. Without it, the invite-link row (a long monospace URL) forced the card wider than the meeting-prep grid's natural width the moment a link was generated, which also re-flowed the card grid to more columns. At `width: 400` (312px of content after padding), the grid's `minmax(128px, 1fr)` math only ever fits exactly **2 columns** (`128×2 + 8px gap = 264px` fits; `128×3 + 16px gap = 400px` doesn't) — so every screen (before creating a link, after, with a meeting-prep card selected or not) now renders at the same width and column count
- **Start Now / Schedule** tab switcher:
  - **Start Now** — Meet / Sting mode toggle; enter name; start immediately
    - **Sting mode theming** — selecting **Sting** turns the BEEHIVE logo, the active lobby tab (Start Now / Schedule, whichever is currently selected), the "Start Sting" button, and the Schedule tab's "Create Meeting & Get Link" button red (`STING_RED`, `#ef4444`, defined once in `roomUtils.ts`) — the selection persists across tabs, so switching from Start Now to Schedule keeps the red theme applied. Tuned for contrast: the original `#a91b1b` measured only ~2.3–2.7:1 against this app's dark backgrounds — under WCAG AA's 3:1 minimum for large text — `#ef4444` measures ~4.8–5.2:1, clearing AA for normal text while still reading unambiguously as red

**Signature button convention:** every primary-action button in the app follows one rule — **signature gold (`#f5a623`) by default, `STING_RED` when the surrounding context is in Sting mode.** This is `components/roomStyles.ts`'s shared `primaryBtn` (`background: '#f5a623', color: '#000'` — black text for AA contrast on the light gold fill; the same black-on-red pairing also clears AA against `STING_RED`), overridden per-button with `subtext === 'Sting' ? STING_RED : ...` wherever a Meet/Sting toggle is in scope. In-meeting components without direct access to `subtext` (`InviteModal`, `ReactionComposer`) receive it as an `accent` prop computed once in `MeetingRoom` (`const accent = subtext === 'Sting' ? STING_RED : '#f5a623'`) so their primary buttons stay in sync with the room's mode. Applies to: Lobby's Start/Join/Register buttons, Schedule's Create Meeting/Send Invite buttons, the in-room chat send button, the Invite modal's Copy Link button, and the reaction composer's Send button. `AuthScreen`'s buttons use the same `#f5a623` for visual consistency but have no Sting override — there's no Meet/Sting context before signing in. Verified consistent across **every version of the app** (macOS desktop, web desktop browser, mobile web): there is no platform-specific style override anywhere in the codebase (no `isMobile`/`isElectron` branch changes a button's color) — web, desktop, and mobile all render the same `roomStyles.ts`/`AuthScreen.tsx` styles from the same React bundle, so a color fix here is a color fix everywhere at once.
  - **Schedule** — pick date + time (`TimePicker.tsx` — a custom two-column hour/minute dropdown, used because Safari renders no dropdown at all for a native `<input type="time">`; identical look/behavior across Safari, Firefox, Chrome, and the desktop app) + **duration** (15m/30m/45m/1h/1.5h — the 1.5h pill previously showed "1.5h 30m" from unrounded division; now floors to whole hours), add attendee emails as chips, generate an invite link, copy it or send pre-filled email invites via the system mail client; room is created in Supabase up front so the link works immediately. **"Create Meeting & Get Link" is greyed out and disabled** until name, date, and time are all filled in (the same `formReady` gate the Smart Meeting Preparation assistant below uses — both agree on "ready to schedule"). Also includes the **Smart Meeting Preparation** assistant (below). Clicking **Send Email Invite** opens the mail client, shows a "Meeting set up successfully" toast, and returns the host to the **Start Now** tab, where the meeting's name and date/time now appear as a dismissible **Next meeting** card above the usual start controls (persisted in `localStorage` so it survives a page reload; cleared via its own **×**)
- Invite preview — guests visiting a `?room=ROOM_ID` link see the room name and live participant count before joining
- **Register CTA (Beta)** — the register control card-flips the lobby card to the `RegisterPanel`, which — during the private Beta — shows a **`Beta`** badge and a "Request access from X Spark" button (`mailto:studio@xspark.co.za`) instead of a self-serve form (see [Authentication](#authentication))
- **Post-meeting register** — guests who joined via room link are prompted to request Beta access when they return to the lobby after a meeting ends (same card-flip animation)
- **User strip** — authenticated users see their name and a Sign out button at the top of the lobby card
- **Recent meetings** — expandable Fathom panel showing AI-summarised past meetings
- **"Built by X Spark" credit** (`components/BuiltByFooter.tsx`) — fixed bottom-right corner of the sign-in screen and the lobby, linking to `https://www.xspark.co.za`. Uses the app's standard footnote styling (`#555`, 11px, Roboto Light) so it reads as part of the UI. A single shared component so the two placements can never drift out of sync; not shown during an active meeting, where the corner is already used for room controls
- **Open in desktop app** — web-only button below "Recent meetings", shown **only to authenticated (seed / fully registered) users**; hands off the signed-in session to the BeeHive desktop app via the `beehive://` deep link, with an OS-aware download link beneath it — macOS serves the native `.dmg` via a direct GitHub Release asset link (see [Authentication](#authentication))

#### Smart Meeting Preparation

Inside the **Schedule** tab, once the basics (name / date / time / duration / attendees) are set, a preparation assistant helps the host walk into the meeting prepared. Components: `MeetingPrep.tsx` (UI) + `meetingTemplates.ts` (data).

- **Only appears once the basics are filled in** — the whole prep section (cards + panel) is hidden until name/date/time are set, so it reads as a helpful next step rather than a wall of UI upfront; entirely optional from there — pick a card or ignore it
- **Skip options** — a gold link next to the "Prepare for this meeting" label collapses the whole card grid for hosts who want to go straight to "Create Meeting & Get Link" without picking a template; a "Show meeting prep options" link takes its place to bring the grid back. Only offered before a card is picked — once one is selected, "Back to meeting types" (below) is the way back to the full set instead
- **Selecting a card collapses the rest** — once a template is picked, the other cards disappear and the selected one spans the full grid width (rather than leaving the neighbouring slot empty); a "Back to meeting types" link returns to the full grid. The card grid's container never changes width in any of these states (fixed-width `lobbyCard`, see [Lobby](#lobby)), so the surrounding layout never shifts
- **Meeting-type cards** — a responsive, scrollable grid of ~21 templates (Board, Client, Follow-up, Brainstorm, Project Kickoff, Team Stand-up, Sales, Training, Interview, Executive, Workshop, One-on-One, Performance Review, Sprint Planning / Review / Retro, Investor, Product Demo, Discovery Call, Quarterly Review, Annual Planning). Each card is a simple monochrome `lucide-react` icon + title + description — consistent with the rest of the app's icon language rather than emoji — keyboard-focusable (`aria-pressed`, focus ring), touch-friendly, and lifts on hover
- **Per-type preparation** — selecting a card expands a panel with the template's suggested **objectives**, **agenda**, **preparation checklist / documents**, **questions**, **suggested attendees**, and **risks to watch**
- **Editable throughout** — the agenda is an editable list (add / edit / remove rows); the checklist ("AI thinks you'll probably need…") is interactive — check / uncheck / **add custom items** / remove
- **Live readiness dashboard** — a real-time score (documents-ready 60% + attendees invited 20% + duration set 20%), a colour-coded progress bar, a **Missing** list, and an **estimated prep time** (~4 min per outstanding document + fixed costs for gaps)
- **Rule-based smart recommendations** — genuine deterministic logic, e.g. "your agenda has 12 topics for a 30-minute meeting (~2.5 min each) — consider increasing the duration or trimming the agenda", plus prompts to add attendees / set a duration
- **Extensibility** — adding a meeting type is a single entry in `MEETING_TEMPLATES` (no component changes)
- **Follows the meeting into the room** — whatever template/checklist/agenda was selected while scheduling is available **during** the meeting itself, not just at scheduling time. `MeetingPrep` reports its current selection upward (`onChange`); `SchedulePanel` persists it (`saveMeetingPrep`/`loadMeetingPrep` in `roomUtils.ts`, keyed by room id in `localStorage`) at the moment the room is created (and again if the selection changes before the invite is sent). Once in the meeting, a **Meeting prep** button (`ClipboardList` icon, only shown when a template was actually picked) toggles a floating `MeetingPrepWindow` — top-left, alongside the other floating windows — showing the agenda and an interactive checklist (checking items off updates the same stored entry). It collapses to a small pill (click to re-expand) rather than fully closing, so it can stay reachable through the whole meeting without permanently occupying screen space
- **Scope (v1):** all preparation content is deterministic template data — **no language model is called**. The PRD's history-aware behaviours (e.g. "your third meeting with this client", auto-attaching relevant files, generated briefings, and persisted / shareable personal & organisation templates) need a backend + model + stored history and are intentionally left for a later phase rather than mocked

#### Waiting Room & Host-Delegated Admit Rights (scheduled meetings only)

The meeting creator of a **scheduled** meeting controls who's let in. This is **new capability, not a refinement** of anything that existed before — join was previously fully frictionless for every room. It's deliberately scoped to the Schedule tab only: **Start Now stays exactly as instant as it's always been** — no host concept, no gate, no waiting room.

- **How host identity works without requiring sign-in**: rooms can be created by anonymous guests as well as signed-in users, so "host" can't rely on a Supabase auth session. Scheduling a meeting (`SchedulePanel.tsx` → `useScheduleRoom` → `POST /api/rooms/schedule`) mints a random `host_secret` **server-side** and returns it once; the creator's browser stores it in `localStorage` under `beehive:hostSecret:<roomId>` and sends it back on every subsequent join to that room from that device. The secret is **never** part of the shareable invite link, and never lands on any client-readable table — it lives in a dedicated `room_hosts` table with RLS enabled and **zero policies at all** (not even SELECT), reachable only by the backend's service-role client. Losing that browser's `localStorage` means losing "automatic host" status on that device; there's no recovery flow for that yet (see Roadmap).
- **Why admission state is its own table, not a `room_participants` column**: `room_participants` already has a fully permissive `UPDATE ... USING (true)` RLS policy (supports other legitimate client updates like `is_active`/`left_at`, and is out of scope to tighten). Adding admission status directly there would let any attendee self-admit with one anon-key REST call. `admission_requests` has permissive SELECT/INSERT (anyone can request to join, and both the waiting attendee and the host/co-hosts need to read live status via Realtime) but **no UPDATE policy for anon/authenticated at all** — status only ever changes through `POST /api/rooms/:roomId/admit`, using the backend's service-role client. Verified directly: a PATCH via the anon key against a real pending request updates zero rows and leaves it unchanged.
- **The gate lives in `/api/livekit/token`**, not the UI: `rooms.requires_admission` (false by default; true only on rooms created via `/api/rooms/schedule`) decides whether this endpoint applies any gate at all. A matching `hostSecret` issues a token immediately (and upserts that identity's `room_participants` role to `'host'`). Otherwise it upserts a `pending` `admission_requests` row (idempotent per `(room_id, identity)`, so retries/reconnects don't pile up duplicates) and responds **202** with no token; a `'denied'` row responds **403**; an `'admitted'` row (e.g. a reconnect) issues a token normally.
- **Waiting screen** (`components/WaitingRoom.tsx`): shown the instant a join attempt comes back pending. Subscribes to that one `admission_requests` row via Realtime and, the moment its `status` flips to `'admitted'`, automatically retries the join with the **same identity** as the original request (so it resolves the row that was just decided, rather than filing a new one) and proceeds straight into the meeting — no manual "try again" step. A `'denied'` decision shows a plain terminal message instead.
- **Waiting Room panel** (`components/AdmissionRequestsWindow.tsx`, `DoorOpen` icon in the control bar) — shown only to whoever's own `room_participants.role` is `'host'` or `'co-host'` in this specific meeting (derived from the same live `useParticipants` list the Participants window already uses — no extra subscription). Lists everyone currently held at the door, live-updating via Realtime, with Admit/Deny buttons.
  - **Regression fixed: the host had no way to learn anyone was waiting short of manually opening this panel.** `AdmissionRequestsWindow` originally ran its own Realtime subscription, but only while mounted — which only happened once the host had already clicked the toolbar button, with no badge, toast, or any other signal to prompt that click in the first place. Confirmed directly against a real scheduled meeting: two attendees sat in `admission_requests` at `status: 'pending'` for the entire life of the room, the host's session never surfaced them, and the meeting ended with both still stuck in `WaitingRoom`. Fixed by lifting the subscription into a shared hook, `useAdmissionRequests(roomId, canAdmit)` (`livekit_react_hooks.tsx`), that stays subscribed for the whole session whenever the current user can admit — not just while the panel happens to be open. `RoomPage` now shows a live pending-count badge on the (closed or open) toolbar button and fires a one-time toast ("X wants to join the meeting") the instant a new request lands; `AdmissionRequestsWindow` itself was simplified to a plain consumer of that one shared list instead of running a second, duplicate subscription to the same table.
- **Delegating admit rights**: in the Participants window, the room's actual creator (checked via a valid `hostSecret` present in `localStorage` for this room — a co-host has none, so this control never appears for them) gets a crown toggle next to each other participant to make/unmake them a co-host. `POST /api/rooms/:roomId/grant-co-host` requires the `hostSecret` specifically, not just a role check — a co-host can admit people but can never mint more co-hosts, keeping one clear locus of control.
- **`room_participants.role`** (`'host' | 'co-host' | 'participant'`) already existed in the schema from the very first migration but had never been read or written anywhere until this feature — every row was just `'participant'`. This wires it up for real rather than adding a redundant column.
- Verified end-to-end via Playwright (schedule → attendee hits the waiting screen with no LiveKit connection → host sees the request in the panel → admits → attendee proceeds automatically) and via direct `curl` against every endpoint, including both negative security tests (self-admit via the anon key, reading `room_hosts` via the anon key) — both correctly rejected.

### In Meeting

#### Header — Desktop
| Element | Position | Notes |
|---------|----------|-------|
| **BEE**HIVE wordmark | Left | App name |
| Participant count pill | Left | Click to open Participants window; the number itself is signature gold + semi-bold, distinct from the grey "participant(s)" label beside it |
| **Meeting timer** | Centre | Elapsed time in grey (`M:SS` / `H:MM:SS`); pointer-events none so it doesn't block dragging |
| Stop Sharing | Right | Green pill — only visible when actively sharing screen |
| Chat toggle | Right | Opens/closes chat sidebar |
| Leave | Right | Red; disconnects and returns to lobby |

#### Header — Mobile (≤ 640 px)
Compact single-row header; timer and secondary controls move elsewhere to save space.

| Element | Notes |
|---------|-------|
| **BEE**HIVE wordmark | Smaller font (12 px, letterSpacing 2); `whiteSpace: nowrap`; left side shrinks before right |
| Participant count pill | Shows full `N participant(s)` on phones > 430 px; shows count number only (e.g. `3`) on ≤ 430 px to prevent overflow |
| Leave | Compact red button (`flexShrink: 0`); always fully visible |
| Chat, Stop Sharing | Hidden from header — Chat accessible via scrollable controls bar |
| **Meeting timer** | Floating pill overlaid at the top-centre of the video area (not in the header) |

Header flex is `minWidth: 0` / `flexShrink: 1` on the left group and `flexShrink: 0` on the right — left content compresses, Leave button stays whole on every screen size.

#### Controls Bar — Desktop (left → right)
| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | LiveKit-managed; mute/unmute |
| Speaker | `Volume2` / `VolumeX` | Mutes/unmutes all remote audio output; red when muted |
| Camera | `TrackToggle` | LiveKit-managed; on/off |
| Background | `Layers` | Opens background effects menu; amber when active |
| Auto Cam | `Aperture` | Opens cam mode menu; blue when active |
| Reactions | `Smile` | Click to toggle emoji picker above bar; floating animations |
| Raise Hand | `Hand` | Broadcasts a raised-hand chip to all participants; green when active; click again to lower |
| Invite Link | `Link` | Opens share modal — copy `?room=ROOM_ID` link to share with anyone |
| Video Quality | `Film` + HD badge | Low 360p / Medium 720p / High 1080p dropdown |
| Screen Share | `Monitor` / `MonitorOff` | Opens pre-share menu; green when active; click again to stop |
| **Stop Sharing** | `MonitorOff` + label | Red pill — appears in controls bar **and** in the header when actively sharing |
| Leave | `PhoneOff` | Red; disconnects and returns to lobby |

#### Controls Bar — Mobile (≤ 640 px)
A **single horizontally scrollable row** at the bottom of the screen — all controls are always reachable by swiping; no hidden "More" panel. The scrollbar is hidden via `::-webkit-scrollbar { display: none }` and `scrollbarWidth: none`. Dropdown menus (Background, AutoCam, Quality, Share) render outside the overflow container (sibling divs in the bottom overlay) so they float upward without being clipped.

| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | Mute/unmute |
| Speaker | `Volume2` / `VolumeX` | Silence/restore remote audio; red when muted |
| Camera | `TrackToggle` | Camera on/off |
| Reactions | `Smile` | Toggle emoji panel above bar (amber when open) |
| Invite Link | `Link` | Copy room link / open InviteModal |
| Raise Hand | `Hand` | Raise hand; green when active |
| Background | `Layers` | Background effects menu (floats above bar) |
| Auto Cam | `Aperture` | Auto centre / 2-in-1 |
| Quality | `Film` + HD | Video quality selector |
| Screen Share | `Monitor` | Share screen |
| Chat | `MessageSquare` | Toggle chat sidebar (blue when open) |
| Leave | `PhoneOff` | Red; end call |

Button size: **40 px** on phones ≤ 430 px (`isSmallPhone`), **46 px** on wider mobile screens.

**Emoji panel** appears as an absolute chip above the scroll row; tapping any emoji sends it and closes the panel.

#### In-meeting Features
- 🎥 HD video conferencing via LiveKit (`GridLayout` + `ParticipantTile`); camera and mic **start off by default on join** (`<LiveKitRoom video={false} audio={false}>`, `RoomPage.tsx`) — participants opt in via the Mic/Camera toggle buttons once in the room, rather than the room requesting device access immediately on connect
- **Mic/camera device-error visibility** — every `TrackToggle` (mic and camera, across the mobile row, minimised presenter bar, and full desktop bar) wires an `onDeviceError` handler. Without it, a failed `setMicrophoneEnabled`/`setCameraEnabled` call (blocked OS permission, no device present, device already claimed by another app) fails **silently** — the button just doesn't change state, with nothing in the UI or console to explain why, which looks exactly like "the button doesn't work" from a bug report with no way to diagnose it. The handler logs the real error to the console and surfaces a plain-language `Toast` ("Microphone access is blocked…", "No microphone found…", etc.) so a failure is always visible instead of silent
  - **Once a permission is explicitly denied, no app can make the browser or macOS show that prompt again** — this is deliberate OS/browser security behavior (getUserMedia() and Electron's `askForMediaAccess()` both refuse silently after a denial), not something re-clicking the mic/camera button can override. The most useful thing left to do is take the user straight to the right settings screen instead of just saying "blocked": in the desktop app, a `NotAllowedError` opens macOS's **Privacy & Security → Camera/Microphone** pane directly (`electron/main.cjs`'s `open-media-privacy-settings` IPC handler, via `x-apple.systempreferences:` — the toast then asks the user to enable it there and relaunch); on the web, where no equivalent cross-browser settings deep link exists, the toast instead points at the permission icon in the browser's address bar
- 🖱️ **Apple Dock magnification** (desktop) — hovering the controls bar magnifies icons with a Gaussian bell-curve wave; a two-pass cumulative X-shift pushes neighbours apart so gaps between icons are always preserved at any zoom level; spring-pop entry, fast cursor-tracking, and a micro-bounce settle on leave; `transform-origin: center` keeps click hit-areas aligned with visuals at all scales
- 😊 **Emoji reactions** — two modes triggered by the `Smile` button:
  - **Quick tap**: emoji floats up immediately (👍 ❤️ 😂 🎉 👏 🔥); visible to all participants via Supabase Realtime
  - **Long-press / right-click**: opens a composer popover anchored above the emoji — pre-filled with a smart editable sentence (`Sapho agrees.`, `Sapho loves this.` etc.); 50-char limit; Enter sends, Esc cancels, click-away closes; message broadcasts to all as a glassmorphism floating pill; 5 s rate-limit cooldown per sender
- ✋ **Raise hand** — `Hand` button broadcasts your name to all participants via Supabase Realtime (`hands:{roomId}`); raised hands appear as floating chips in the top-right of the video area showing ✋ + name; any participant can tap × to lower an individual hand, or "Lower all" to clear all at once; the broadcaster's own state stays in sync
- 🔇 **Speaker mute** — `Volume2` / `VolumeX` button silences all `<audio>` elements in the page (mutes remote audio output without affecting the microphone); red border when active
- 🎙️ **Background-noise suppression** — the mic is automatically run through LiveKit's Krisp noise-filter processor, which filters ambient/background noise and isolates the speaker's voice; applied to every mic track this participant publishes (including after toggling the mic off and back on, which creates a fresh track); the ~5–6 MB Krisp WASM/ML payload is **lazy-loaded** on first mic publish via dynamic `import()` — it never bloats the initial page load; silently skipped on unsupported browsers/platforms, so it never blocks the mic
- 🔗 Invite link — opens a share modal showing the plain `?room=ROOM_ID` link; anyone can copy and share it; recipients join directly with no account required
- 📽️ Video quality selector — Low (360p) / Medium (720p) / High (1080p)
- 🎨 Background Effects (`Layers` button, amber when active) — four modes:
  - **None** — restores original camera track
  - **Blur** — background blurred with a portrait-lens depth-of-field falloff (see below); intensity slider (2–20 px); Flip toggle
  - **Effects apply even if enabled before the camera is on** — the pipeline effect bails when there's no camera track, and its dependencies previously never re-triggered it when one appeared: toggling any background effect (or Flip) with the camera off silently did nothing for the rest of the session, which read as "the buttons don't work". The camera track's presence is now a dependency (`camTrackReady`), so the pipeline auto-starts the moment the camera comes on. The **Flip** rows are also now clickable across their full width (icon + label + pill), not just the small On/Off pill
  - **Image** — upload any photo; cover-fitted as background; Flip toggle. The uploaded image **persists across meetings and app restarts** (stored in localStorage as a downscaled ≤1600px JPEG data-URL — comfortably inside quota, and the compositing canvas is capped at 1280px wide so nothing visible is lost) and is restored automatically on the next session; it stays until explicitly removed via the trash button next to the filename (removing it also switches the effect off if it was active)
  - **Virtual** — 8 procedurally drawn scene presets (Office, Beach, City, Forest, Mountains, Space, Sunset, Studio)
  - **Aspect-ratio-correct pipeline** — the output canvas is sized from the **real camera resolution** (preserving 16:9 / whatever the webcam reports, capped at 1280 px wide), so nothing is stretched or squashed. `replaceTrack` swaps the published LiveKit video track with `canvas.captureStream(30)`
  - **Camera released properly after using any background effect** — `replaceTrack(track)`'s second argument (`userProvidedTrack`) defaults to `true`, which tells LiveKit "the app owns this track's lifecycle, don't stop it yourself." That's correct for the canvas track above (the app does manage it — `seg.close()` and letting the canvas GC on cleanup), but the two places that restore the *original raw camera track* back onto the publication (toggling the effect off mid-session, and the effect's unmount cleanup on Leave) were calling `replaceTrack(bgOrigTrackRef.current)` with no second argument — silently reassigning that real camera track's ownership away from LiveKit too. Once background effects had been used even once in a session, LiveKit's own disconnect/unpublish logic no longer stopped that track: the camera LED and OS-level "in use" indicator stayed on after Leave, and a fresh join would compound another live track on top rather than starting clean. Fixed by passing `false` explicitly at both call sites, restoring the exact ownership a camera that never touched a background effect already has. Verified with a live before/after: a camera enabled, run through Blur, then Leave — before the fix, the underlying `MediaStreamTrack.readyState` stayed `'live'` after leaving; after the fix, it correctly reaches `'ended'`, identically to the always-worked no-background-effect path. Confirmed the fix also holds when the camera is toggled off and back on mid-session while a background effect stays active (re-tested against the exact repro after that addition, still clean)
  - **Belt-and-braces explicit shutdown on Leave** — on top of the ownership fix, `leaveWithNotification` now calls `localParticipant.setCameraEnabled(false)` / `setMicrophoneEnabled(false)` directly as its very first, awaited step, using the same official LiveKit API the manual mic/camera toggle buttons already use successfully every time. This guarantees the hardware is confirmed off before the rest of the leave sequence even starts, independent of any React unmount/cleanup ordering — rather than only relying on `<LiveKitRoom>`'s own disconnect-time cleanup to get to it

  **Segmentation engine** (`components/segmentation/`) — a `SegmentationEngine` interface with two interchangeable implementations, so the rendering pipeline never knows or cares which one is active:
  - **MediaPipe Tasks Vision `ImageSegmenter`** (`tasksVisionEngine.ts`) — the current, actively-maintained Google API. GPU-delegated by default, automatically retrying on CPU if GPU init fails. Converts its confidence-mask output (`MPMask`) into a small drawable canvas so the rest of the pipeline is unaffected by which engine produced it.
  - **Post-outage rebuild (July 2026)** — the entire background feature was silently dead after the engine-interface migration: the interface hands each callback the *bare mask*, but `RoomPage.tsx`'s `onResults` still read `results.segmentationMask` off it (undefined), so `processMask` threw on **every frame, on both engines** — the runtime circuit-breaker dutifully downgraded Tasks Vision → legacy, which then failed identically, and no effect ever rendered (published track stayed the raw camera). Found by driving the real UI headlessly and reading the `[segmentation:*] frame failed` logs; the legacy engine failing with the *same* error was the tell that the bug was in the caller, not the engine. Fixed alongside three real performance/quality defects found in the same audit:
  - **Silent-failure diagnostics** — that whole outage was only discoverable because it happened to log to the console; any *other* exception thrown inside `onResults` (or inside `init()` if BOTH engines fail to construct — `createSegmentationEngine()`'s legacy-engine fallback wasn't itself wrapped, so if it also threw, `init()` rejected unhandled) hits exactly the same failure shape: the resilience wrapper's failure counter downgrades Tasks Vision → legacy, but once already on legacy there's no further fallback, so a callback that fails on *every* frame — say, an edge case triggered only by a specific real camera's resolution/aspect ratio that a synthetic test camera never reproduces — fails silently forever. `trackReplaced` never flips true, so the raw camera keeps publishing unprocessed with zero visible indication anything is wrong: exactly "the effect is selected but does nothing," reported on the web version with a real camera after every fake-camera test this session passed cleanly. Both failure points now surface a toast (reusing the existing `deviceErrorToast`) and a `console.error`, so a real failure is visible and diagnosable instead of indistinguishable from "should just work." Confirmed this adds zero behavior change on the working path — re-ran the full test suite after adding it, still zero errors, no toast fires
  - **Safari/WebKit blur fix — `ctx.filter` is a silent no-op there** — the actual root cause of "blur does nothing on the web version" (reported from Safari): WebKit *accepts* `ctx.filter = 'blur(...)'` — the property round-trips, so naive feature detection lies — but **renders it as a no-op**. Proven against the real WebKit engine (Playwright WebKit): a hard black/white edge drawn through `blur(8px)` stays pure black at the boundary where Chromium yields mid-grey `[121,121,121]`. Every blur in this pipeline (far/near depth-of-field passes, mask feather, halo, matte close) used that API, so on Safari the entire effect degraded to "sharp background + hard-edged sharp cutout" — reads as no blur at all, with edge misregistration looking like a "duplicated" person. Every prior test this session ran on Chromium, where it works — which is exactly why it never showed up. Fixed with `canvasFilterBlurWorks()` (`roomUtils.ts`) — detection that tests what the filter actually *renders*, not whether the property sticks — and `pyramidBlur()`, a filter-free approximate Gaussian (repeated half-resolution `drawImage` downscales, then stepwise upscale; GPU-accelerated, universally supported, and edge-clamped so the CSS blur's overscan anti-vignette trick isn't even needed). All five blur sites branch on the detection: Chromium/Electron keep the native filter path byte-identical; WebKit gets the pyramid path. Verified in the real WebKit engine via the actual shipping module served through Vite: detection correctly reports `false` there, and the fallback produces a genuinely blurred edge (pixel 124 — same mid-grey Chromium's native filter produces)
  - **Hard camera kill-switch on unmount** — every way of leaving a meeting (Leave button, alone-timer, remote disconnect, meeting ended) now also directly calls `MediaStreamTrack.stop()` on whatever track sits on each LiveKit publication *plus* the background pipeline's saved original camera track. Plain, terminal, idempotent — immune to SDK track-ownership semantics and async-cleanup ordering (the background pipeline's `replaceTrack` restore is async and, on Safari's scheduling, could lose the race against disconnect — leaving the camera LED on in the lobby even with the ownership fix in place). Safe under StrictMode's synthetic first-mount cleanup: camera/mic are still off at that point and the ref is null
    - **Bounded mask readback** — the `ImageSegmenter` returns its confidence mask at the *input's* resolution (verified live, not assumed), and reading it back stalls the GPU (Chrome flags "GPU stall due to ReadPixels, High"). Feeding it raw 720p meant a ~3.7 MB float readback + a fresh multi-MB `ImageData` allocation + a ~921k-iteration conversion loop *per frame* — for zero benefit, since the model resizes everything to 256×256 internally. The adapter now downscales the video (GPU-side) onto an internal 512-wide canvas first: readback cost drops ~6× at 720p, is constant regardless of camera resolution, and the returned mask lands exactly at `processMask()`'s 512-px working resolution (no wasteful re-resample). Conversion buffers persist across frames (no per-frame allocation → no GC jitter), confidences are read as bytes (`getAsUint8Array`), and each pixel is written with a single 32-bit store.
    - **True per-camera-frame pacing** — the frame loop used `requestAnimationFrame`, which fires at the *display's* refresh rate: a 120 Hz ProMotion Mac segmented the same 30 fps camera frame up to 4×, quadrupling inference cost and compounding the temporal-smoothing EMA (α = 0.65 applied 4× ≈ 0.985 — effectively **no** smoothing, i.e. the exact mask flicker the EMA exists to prevent, with strength silently varying by monitor). Now `requestVideoFrameCallback` (with rAF fallback) fires exactly once per new camera frame, and a busy-flag drops frames instead of queueing them if inference ever lags — latency stays bounded during fast movement.
    - **Confidence ramp recalibrated** — the ramp floor (`RAMP_LO = 70`, ~27%) was tuned for the legacy engine's post-processed, near-binary masks; Tasks Vision's *raw* confidences on motion-blurred hands, hair wisps, and glasses legitimately sit at 0.2–0.5, and the old floor amputated them (hands turning transparent mid-gesture). Now 45/175: junk below ~18% still crushed, genuine mid-confidence body pixels kept.
  - **Legacy MediaPipe Selfie Segmentation** (`legacyEngine.ts`) — the original CDN-loaded API (`modelSelection: 0`, the higher-quality of its two model options), kept as a permanent automatic fallback, not a temporary migration shim: if Tasks Vision fails to initialize for any reason (model URL unreachable, GPU/browser incompatibility, WASM load failure), `createSegmentationEngine()` silently falls back to this proven engine so a video call never breaks over a segmentation hiccup. Which engine is active, and rolling frame-time/FPS, are logged to the console (`[segmentation] using MediaPipe Tasks Vision...` / `[segmentation:*] avg frame time: ...`) — a debugging breadcrumb, not a UI feature.

  **Mask quality pipeline** (`RoomPage.tsx`'s `processMask()`) — three stages applied to every frame's raw mask, regardless of which engine produced it:
  1. **Confidence ramp** — a wide smoothstep curve (not a hard threshold) crushes low-confidence "junk" (person-adjacent objects like pillows or chair backs, which MediaPipe scores as mid-confidence) toward invisible, while keeping genuinely soft edges — hair strands, finger edges — soft rather than binarized. A prior hard-threshold version of this caused a visible "cut-out pasted on" look; the smoothstep ramp is what fixed it.
  2. **Feather** — a small blur (`ctx.filter`, not a pixel loop) softens the ramped edge so it blends into the background instead of cutting.
  3. **Temporal smoothing** — an exponential moving average across frames, implemented via canvas alpha compositing (`lighter` blend mode, mathematically exact, no per-pixel JS) with correct decay in both directions — a transient misclassification fades out within a few frames rather than sticking on screen permanently (an earlier, naive temporal-blend attempt got this wrong: `source-over` compositing can only ever *grow* a mask, never shrink it, which caused visible ghost smears until fixed).
  4. **Final matte shaping** (post-EMA, two small GPU draws, no readback) — the composite doesn't use the smoothed mask directly; it uses a *closed and opacity-saturated* copy: a ~1px blur acts as a morphological close (transient pinholes inside hands/arms — the "floating holes" artifact — get filled by neighboring alpha before saturation locks them opaque, plus a touch of sub-pixel edge smoothing), then a `lighter` self-composite boosts α → min(1, 1.5α). Raw confidences inside the torso can dip to ~0.6 for a few frames, which used to render the body itself faintly translucent (background visible through clothing); the boost saturates anything above ~0.67 to fully opaque while the sub-0.5 hair band keeps graded translucency — a real alpha matte, not a binary cutout. With interior opacity guaranteed by the boost rather than by a conservative ramp, the ramp floor drops (45 → 35) to admit flyaway-hair confidences (~0.15–0.35) the old floor culled, and the pre-EMA feather shrinks 3 → 2px so the close-blur doesn't stack into over-smoothed "helmet hair". Tunables: `MATTE_CLOSE_BLUR_PX` (1), `MATTE_OPACITY_BOOST` (0.5), `RAMP_LO/HI` (35/175), `FEATHER_PX` (2). The DOF halo still derives from the pre-matte smoothed mask, so blur falloff is unchanged.
  - **Clean blur** — the blurred layer is drawn with an overscan so the blur kernel's faded edges fall outside the frame, eliminating the dark-vignette rim a naive canvas blur produces.
  - **Depth-of-field blur** — instead of one uniform blur radius, background near the subject's silhouette stays relatively sharp while background farther away gets progressively softer, mimicking a portrait lens's focus falloff. There's no real depth data (a single 2D confidence mask, no stereo/LiDAR), so the "nearness" cue is faked by blurring the subject's own already-smoothed mask with a large radius — the result is a continuous, artifact-free falloff, because it's mathematically guaranteed to align with the actual silhouette (it *is* that silhouette, just softened further) rather than a second, independently-computed halo.
  - **Subtle background color match** — the subject's exposure/saturation is nudged a few percent toward the background's average tone (sampled once per background change, not per frame, and tightly capped) so they don't look like two mismatched exposures pasted together.
  - **Subtle foreground contrast** — a small, flat contrast boost on the subject only, for a bit of "portrait pop" without a beauty-filter look.
- 📸 Auto Cam — floating window (bottom-right), two modes:
  - **Auto Centre** — follows the active speaker (1.5 s debounce); crosshair name tag
  - **2 in 1** — local (You) left, active speaker right; "Waiting…" when no remote speaker
- 🖥️ Screen sharing & presentation mode:
  - Pre-share menu: **Entire Screen** / **Select Window** (web also shows **Clear screen before sharing** toggle)
  - **Web — Entire Screen**: auto-enables clear-screen mode to avoid BeeHive echoing itself before capture; clears the flag after
  - **Web — Select Window**: standard browser screen-share picker
  - **Electron — Entire Screen**: uses `desktopCapturer` with `types: ['screen']` to grab the primary display directly — no OS dialog
  - **Electron — Select Window**: opens the `ElectronWindowPicker` modal; **single click** locks the selection (green border); **double-click** or the **Confirm** button shares immediately — moving the mouse does not deselect
  - Share menu: `position: fixed; bottom: 84px` centered with `maxHeight: calc(100vh - 120px)` — never overflows on 13" displays
  - Controls bar: `maxWidth: 96vw; flexWrap: wrap` — all buttons remain accessible on narrow screens (13" MacBook)
  - Active share bar: source label, **Add Window**, **Switch** (live `replaceTrack`), **Stop Sharing**
  - **Local share (presenter)**: main area shows live `<video>` preview of the shared stream — no mirror echo; fallback "Broadcasting…" shown while stream initialises
  - 🖥️ **Persistent sharing indicator** — always visible while sharing (top-left of the preview): "You're sharing your entire screen" / "You're sharing '<window title>'", plus elapsed sharing time and a quick **Stop** button
  - 🖱️ **Click-to-focus for window shares** (Electron desktop only) — clicking anywhere on the main-area preview brings the real shared window's owning app to the **foreground** instantly, via a native macOS window-activation call (`NSRunningApplication activateWithOptions:`) — **no input injection, no Accessibility permission required**:
    - The exact window is identified by its `CGWindowNumber`, parsed directly from the `desktopCapturer` source id Electron already resolved when the window was picked — no fuzzy title matching
    - BeeHive keeps running behind the activated window; switch back the normal way (Cmd-Tab, Dock, clicking BeeHive) — a subtle "Click to switch to this window" hint shows over the preview
    - Only applies to **window** shares — entire-screen sharing behaviour is untouched (there's no single window to activate)
    - Implemented by `electron/beehive-ctl.m`, a tiny one-shot native helper (compiled on demand in dev via `clang`, shipped via `extraResources` in packaged builds)
  - 🧊 **Floating Control Dock** (Electron desktop only, window shares) — since click-to-focus backgrounds BeeHive's main window, a separate **always-on-top** window keeps the core meeting controls reachable above whatever app is now in front:
    - Shows: mic mute/unmute, camera on/off, raise/lower hand, previous/next slide (when presenting Keynote/PowerPoint), chat (with unread-DM badge), participants (with live count), active-speaker name, a connection-quality dot, meeting + sharing elapsed timers, **Stop sharing**, and **Leave**
    - **✋ Raised-hands chip** — when *other* attendees raise their hands while the presenter's BeeHive window is hidden behind the shared app, a gold pulsing chip appears in the dock next to the hand button: `✋ Thando` (one hand), `✋ Thando, Lerato` (two), `✋ N hands up` (more). Clicking it opens the Participants window (see below — this no longer force-activates BeeHive's main window, so a full-screen presentation isn't interrupted). Disappears the moment all hands are lowered. The presenter's *own* hand isn't included — that state already shows as the dock's hand button turning green
    - A **separate `BrowserWindow`** (`electron/dock.html`, plain HTML/JS, no React) — it cannot touch the LiveKit `Room` object directly, so actions are relayed through the main process to the main window's renderer (which owns the live connection) and state flows back the same way; state is pushed once per second while the dock is visible
    - Muting, raising a hand, stopping the share, opening **Chat**, or opening **Participants** all act **without** stealing focus back to BeeHive, so the presenter can keep looking at the shared app — the panel's state still opens, it's just visible next time BeeHive is brought forward on the presenter's own terms. Only clicking **Leave** brings BeeHive's main window forward, since the meeting is ending anyway. Chat/Participants used to force-activate the main window too, which — while presenting inside a true macOS full-screen Space (Keynote, PowerPoint) — forced the OS to switch away from that Space, effectively kicking the presenter out of their own full-screen slideshow just to peek at a chat message. Fixed by narrowing `FOCUS_ON_ACTION` (`electron/main.cjs`) to `'leave'` only
    - Positioned bottom-centre of the primary display, draggable, `skipTaskbar`, visible even over fullscreen apps (`setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`)
    - **Stays on top of full-screen slideshows** — Keynote/PowerPoint presentation mode and Preview's full-screen PDF view create windows that stack *above* the `'floating'` always-on-top level, which buried the dock exactly when the presenter needed it most (mid-slideshow); the dock now uses the `'screen-saver'` window level (the same approach screen-annotation overlay tools use), so it stays visible and clickable over a running full-screen presentation. `visibleOnFullScreen` alone only makes it follow onto the full-screen Space — the level is what keeps it on top once there
    - **Never drops a full-screen presentation, no matter what's clicked** — every window-flag attempt at this (`acceptsFirstMouse`, `type: 'panel'`, `focusable: false`, `hiddenInMissionControl`, `skipTransformProcessType` — all still present above) still left the dock as a genuine on-screen window, and delivering it a **real OS click event at all** turned out to be enough on its own for macOS to drop Keynote's/PowerPoint's true full-screen Space, regardless of activation or key-window status. Fixed by removing that possibility entirely: the dock window is **permanently click-through** (`setIgnoreMouseEvents(true)`), so the WindowServer treats every click over it as if the window weren't there.
      - **Getting the buttons working again took two attempts.** The first replacement — `electron/beehive-ctl.m`'s `watch-clicks` mode using an `NSEvent` global mouse monitor — silently failed in real use: contrary to older Apple documentation, modern macOS gates *any* global event monitor (mouse included) behind Input Monitoring permission, and a monitor that's never been granted that permission just never fires, with no error and no prompt — so every dock button looked completely dead. Fixed by dropping the event-stream approach for a plain **hardware-state poll**: `CGEventSourceButtonState()` (is the left button physically down right now?) plus `NSEvent.mouseLocation`, sampled at ~120 Hz and diffed for down/up transitions — both are simple state queries, not an event tap, and neither requires *any* special permission (same category as reading modifier-key state). Whenever a transition lands inside the dock's current screen bounds, `main.cjs` replays it into the *same* window via Electron's `sendInputEvent`, which delivers straight to the renderer's DOM — `dock.html`'s existing `onclick` handlers fire completely unmodified, without the window ever touching the OS's real hit-testing/activation path again. Verified end-to-end with the actual compiled binary before shipping: posted a real synthetic HID-level click, confirmed the poller detected it with zero permission grants, and confirmed the full parse → coordinate-flip (NSEvent's bottom-left origin to Electron's top-left) → bounds-check → replay chain fired the target button.
      - **Stop Sharing and Leave now also exit the slideshow** on Keynote/PowerPoint (not just the other dock buttons, which must *never* touch it) — `stop-presentation` (`electron/main.cjs`) sends each app its own direct "stop"/"exit" AppleScript command, the same permission category as the existing prev/next-slide commands (a normal Apple Event to a scriptable app, not System Events UI-scripting), so it needs no permission beyond whatever Automation access the user already granted for slide navigation. Wired into both `stopShare` and `leaveWithNotification` (`RoomPage.tsx`) as a fire-and-forget call — never awaited, so it can't delay the UI's own stop/leave flow — and silently no-ops if neither app is running
    - **Leave icon fixed** — the phone-off glyph was a hand-drawn filled shape crossed by an unrelated stroked line, the only non-outline icon in the dock; at 15px it rendered as a garbled blob ("damaged"-looking). Replaced with the real Lucide `phone-off` glyph, matching every sibling icon's stroke-only style
    - **Draggable** — reposition by grabbing anywhere on the bar that isn't a button (`body` is a `-webkit-app-region: drag` region; every button is explicitly `no-drag`, so grabbing and clicking never conflict)
    - **Minimise to a small bubble** (`⌄` button, left end of the bar) — collapses the whole dock to a 52px round bubble showing only what a presenter can't afford to miss while collapsed: an unread-chat count badge and a pulsing ✋ dot if anyone's hand is raised. Click the bubble (`⌃`) to expand back to the full bar; the bubble is a drag region too, same drag/no-drag split as the full dock, so it stays repositionable while collapsed
    - **Stronger hover feedback over full-screen apps** — the mic/cam/hand cursor is already `cursor: pointer` (was always set; if it ever looked unclear which app owned the cursor, that's a macOS/Chromium cursor-repaint quirk of sitting above another app's exclusive full-screen surface, not a missing style), but the old hover state was a faint background tint easy to lose against an unpredictable, uncontrollable background behind the semi-transparent bar. Hover now scales the button 12%, adds a solid border, and a soft glow ring — unmistakable regardless of what's rendering underneath
    - **Leave / Stop-sharing require a confirming second click** — on a bar this small and densely packed, a single stray click must never actually end the call or kill the share; every other control (mic, cam, hand, chat, participants, slide nav) stays a single click since those are all reversible. The first click on Leave or Stop *arms* it — the icon-only Leave button widens to a pulsing "End meeting?" pill, the Stop pill's label flips to "Sure?" — and only the *same* button clicked again within 2.5s actually fires the action. Clicking anything else — another control, empty space, dragging the bar — disarms it immediately with no side effect; the arm also auto-expires on its own after 2.5s if left alone
    - Shown only while sharing a **window** (not entire-screen — no other app is in front to hide controls behind in that case)
    - **Auto-hides when the meeting ends** — leaving the meeting (Leave button, alone-timer, or the meeting ending) unmounts the room component in one step while sharing is still active, so the show/hide effect's body never re-runs; a React cleanup on that effect hides the dock on unmount, otherwise it stayed floating over the lobby with frozen timers
  - **Remote share (viewer)**: takes full main area; attendee cameras move off the main grid, reachable via the Participants window (opened by an explicit click — a header-pill count, the dock's Participants button, etc.). This used to force the Participants window open the instant any remote share started, keyed on `hasRemoteScreenShare`; that value flips false→true→false→true across ordinary presenter actions (switching the shared window/source, a brief resubscribe hiccup), and each edge re-ran the effect and reopened the window even right after the viewer had explicitly closed it — reported as both "opens on its own" and "won't stay closed" (they were the same bug). Removed; opening the Participants window is now exclusively a deliberate user action
  - **Presentation overlay** — floats over the presentation on both web and desktop:
    - Controls bar, speaker video window, share bar, and Auto Cam all remain visible on top of the presentation
    - **Minimise (—)** button on the controls bar: collapses to a compact pill (mic · cam · stop share · expand · hide · leave); speaker window hides
    - **Hide (👁)** button: removes all controls from the screen; an amber **"Show controls"** pill appears at the bottom centre to restore
    - Controls auto-restore to full when sharing ends
- 🔳 **Fullscreen** (`Maximize2` / `Minimize2`, top-right of the main area) — expands the presentation/main area to fill the **entire screen** (web + desktop):
  - An overlay (`position: fixed; inset: 0`) makes the main area cover the header, chat sidebar, and participants window
  - Native OS fullscreen is also engaged — Electron via `setFullScreen()` IPC, web via the HTML5 Fullscreen API
  - **Esc**, the macOS green button, or the collapse button all exit; the exit button stays reachable even when controls are hidden
  - **Full-screen attendees/hands/reactions HUD** (`components/FullscreenHud.tsx`) — since the fullscreen overlay covers the normal Participants window, a self-contained floating panel opens automatically the moment fullscreen is entered, mounted inside the same overlay so it stays reachable: live attendee list (mic/camera status, speaking highlighted in gold), raised hands (with per-hand dismiss and "Lower all"), a quick-reaction row, and core controls (mic, camera, raise hand, leave). It can be **minimised** to a small pill (attendee count + hand count, click to re-expand) or **closed** outright — closing reveals a small "Show attendees" button next to the fullscreen toggle to reopen it. Purely additive: the regular Participants window, raised-hand chips, and reaction bubbles outside fullscreen are unchanged
- 🪟 **Pop-out** (`ExternalLink`, top-right of the main area, **desktop only**) — detaches the shared presentation into its own separate, resizable window (Teams-style), so it can be dragged to a second monitor:
  - Works on **web** (`window.open`) and **desktop** (Electron `setWindowOpenHandler` spawns a native child window)
  - Available to the **viewer** (a remote presenter's share) **and** the **presenter** (their own share)
  - Auto-closes when sharing stops
- 🎯 **Laser pointer** (`Crosshair`, top-right of the main area, **desktop only**) — broadcasts your cursor position to everyone:
  - Toggle on, then move the mouse over the main area; all participants see a coloured, name-labelled pointer at that spot
  - Positions are sent over a Supabase Realtime broadcast channel (`cursors:{roomId}`), throttled to ~30 fps; cursor is removed for others when you leave the area or toggle off
- 🎚️ **Presenter slide control** (desktop only, while sharing) — the presenter can drive their **Keynote / PowerPoint** slideshow from the BeeHive main area or in fullscreen, without switching back to the presentation app:
  - On-screen **‹ ›** chevrons on the left/right edges of the main area, plus keyboard **← / →**, **Space**, **PageUp / PageDown**
  - Implemented with AppleScript (`osascript`) via an Electron IPC handler — no native key-injection module required; targets Keynote first, then PowerPoint
  - Requires macOS **Automation** permission (prompted on first use)
- 🔊 Speaking indicator (bottom-left):
  - Animated 5-bar equaliser chip with active speaker's first name
  - Floating speaker video window; **Minimise (—)** / **Close (✕)**; reappears for new speaker
  - `+N` badge when multiple participants speak simultaneously
- 📁 **File sharing** — drag any file onto the meeting area or use the paperclip button:
  - Amber dashed drop zone on drag-over
  - **Send to:** All participants or select individual attendees by name
  - Uploads to Supabase Storage (`shared-files` bucket, 50 MB limit); URL shared via Supabase Realtime
  - Targeted files render as download cards only for named recipients; "To: …" label on targeted shares
- 💬 Real-time chat sidebar (Supabase Realtime). `useChat` (`livekit_react_hooks.tsx`) merges its initial fetch into state by message `id` rather than overwriting it outright, and dedupes realtime-appended messages the same way — makes the hook safe against React StrictMode's dev-only double-mount (two initial fetches can be in flight at once; a plain overwrite risked a slow one clobbering an already-arrived realtime message back out of view). Both the initial fetch and the realtime subscription log to the console on failure (`CHANNEL_ERROR`/`TIMED_OUT`, or a failed insert) instead of failing silently
- 📴 Leave call — marks participant inactive in Supabase and broadcasts a **"[Name] left"** system event to the chat for all remaining attendees
- 👋 **Join / leave notifications** — horizontal-rule system messages in the chat sidebar: green **"[Name] joined"** on entry, grey **"[Name] left"** on exit; written to `chat_messages` with `display_name: '__SYSTEM__'`. The effect that announces a join also marks the participant's `room_participants` row inactive in its cleanup (the fallback for tab-closed/navigated-away, alongside the explicit Leave button's own deactivation) — React StrictMode's dev-only mount→cleanup→remount cycle used to run that cleanup once immediately after the very first mount with nothing to ever flip the row back to active (that only happens once, server-side, before this component even mounts), silently leaving the row `is_active: false` for the rest of the session. Invisible for most things, but it broke anything reading that row afterward — notably the waiting-room feature's host/co-host detection, which made a meeting's own creator unable to see their own admit controls. Fixed by deferring the deactivation by one tick (`setTimeout(0)`) and cancelling it on remount — StrictMode's remount happens synchronously within the same effects flush, before any timer fires, so it reliably cancels the synthetic deactivation while a genuine unmount (no remount to cancel it) still deactivates, just one tick later
- ⏱️ **Auto-end when alone** — if you are the only active participant for 10 minutes, a countdown warning banner appears at the top of the screen (`You're alone — call ends in Xs`); clicking **Stay** resets the timer; the call ends automatically when the countdown reaches zero. "Alone" is determined from `liveKitParticipants` (the live WebRTC room roster — the same source the header's participant count and the floating dock use), **not** the Supabase `room_participants.is_active` flag, which is only flipped by the LiveKit `participant_left` webhook (or an explicit leave) and can drift stale on any webhook delivery hiccup — a previous version used that flag here, and a stale row could make this feature think everyone else had left and start the countdown while the header/video grid still correctly showed multiple live participants, kicking a genuinely active meeting out early
- 🔴 **Meeting ended state** — when the last participant leaves, `rooms.ended_at` is set and `rooms.is_active` is set to false; any subsequent visitor opening the invite link sees a "Meeting Ended" summary card (with end time) and a "Start a new meeting" button — the name input and join button are hidden, preventing re-join
  - **Server-side backstop for ungraceful exits** — `leaveWithNotification` and the alone-timer above both end a room by running client-side JS, which simply never executes if the client exits ungracefully (browser force-quit, crash, killed process, OS-terminated tab) — this was silently leaving hundreds of rooms stuck `is_active: true` forever with no participants actually connected. Fixed by handling LiveKit's `room_finished` webhook event (`livekit_node_backend.js`'s `/api/livekit/webhook`) — LiveKit's own server determines definitively when a room is empty and closes it, independent of how any client disconnected, so this event fires even when every client-side path is skipped. On receipt, the matching `rooms` row is marked `ended_at`/`is_active: false` the same way the graceful-leave path already does. Verified directly against the live backend: created a room via `/api/rooms/schedule`, posted a synthetic `room_finished` event at the webhook endpoint, confirmed the row flipped to ended in the database
  - **Re-checked at the moment of clicking Join, not just on page load** — the lobby only *hides* the Join button based on a one-time snapshot fetched when the invite page loads (`useRoomInfo`), which goes stale if the meeting ends while that tab sits open (host leaves, or the alone-timer above fires). `useJoinRoom`'s `joinRoom` re-fetches `ended_at`/`is_active` fresh at join time and refuses to proceed if the room has since ended — the actual gate, not the button's visibility. On this specific outcome, `handleJoin` (`RoomPage.tsx`) refreshes the invite preview so the lobby flips straight to the "Meeting Ended" card instead of a generic "failed to join" alert. `joinRoom`'s result carries this reason on the resolved value itself (`{ error: ENDED_MEETING_ERROR }` vs. `{ token, ... }`) rather than the hook's separate `error` state — reading that state right after `await`ing the call would see whatever it was *before* this click, since React doesn't re-render mid-await. Verified against the live DB: ending a room between page-load and the Join click is correctly blocked, with no participant/token created for the dead meeting

### Participants Window
- Click the participant count pill in the header to open (desktop only — unchanged original behavior; full-screen mode has its own separate attendee list, see `FullscreenHud` above)
- Opens as a **draggable floating window** — grab the `⠿ PARTICIPANTS` title bar to reposition it anywhere
- Drag it toward the top → an amber "release to dock to header" zone appears → release to **dock as a horizontal strip** directly under the header; grab the strip's **↙** button to undock back to the floating window
- **Always a single horizontal, always-scrollable row of tiles — never a grid** — floating and docked are just two different containers around the exact same row, so dragging between them never changes the tile layout
- Each tile: live video (or a camera-off placeholder), first name, mic status (green/red), camera-off indicator, a direct-message button, and — for the room's actual host, in a waiting-room-gated scheduled meeting — a crown toggle to make/unmake a co-host
- **✕** closes it (from either the floating window or the docked strip)
- Opens only on an explicit click, never on its own — a previous version force-opened this the instant any remote screen share started, keyed on `hasRemoteScreenShare`; that value flips false→true→false→true across ordinary presenter actions (switching the shared window/source, a brief resubscribe hiccup), and every false→true edge re-triggered the open — even right after closing it, which read as "won't stay closed." Removed
- Closes itself once sharing actually ends (both a local share stopping and a remote share ending) — safe in a way forcing it open wasn't, since this can only ever turn it off, never force it back on

---

### Desktop App (Electron)

BeeHive ships as a native desktop app wrapping the same React frontend with an embedded Node.js backend.

**Desktop-specific window chrome:**
- **Draggable header + lobby** — both the in-meeting header and the lobby window have `-webkit-app-region: drag`; interactive children have `no-drag`
- **Traffic light clearance** — Electron builds use 88 px left padding in the header to clear macOS traffic lights; web builds use 18 px
- **Stop Sharing shortcut** — a green "Stop Sharing" button appears in the header when screen sharing is active, in addition to the red pill in the controls bar

**Extra capabilities vs. the web app:**

#### Drag-to-Present (Electron only)
Drag a presentation file (`.key`, `.keynote`, `.pptx`, `.ppt`, `.odp`, `.pdf`) onto the meeting area:

1. BeeHive detects the file extension and shows **"Open in Keynote / PowerPoint"**
2. Click — `shell.openPath()` launches the file in its native app
3. Modal changes to: *"Enter Presentation / Slideshow mode, then click Share Presentation"*
4. User starts the slideshow in Keynote / PowerPoint
5. Click **Share Presentation** — BeeHive calls `desktopCapturer.getSources()` and auto-matches the window by app name (Keynote, PowerPoint, Impress, Slides)
6. A **live thumbnail preview** of the detected window is shown with the amber border — *"This is what attendees will see"*
7. Click **Confirm & Share** → shares the window directly to all attendees, no OS dialog required
8. If no presentation window is detected, the window picker appears as a fallback ("Wrong window?" also opens it)

#### Drag-to-Share (both web and desktop)
Non-presentation files dropped on the meeting area go through the standard file share flow (Supabase Storage upload → download card in chat).

**Key Electron APIs used:**
- `shell.openPath(filePath)` — open file in native app; `File.path` (Electron-added property) gives the local path
- `desktopCapturer.getSources()` — enumerate windows/screens with base64 thumbnails (main process, exposed via IPC)
- `getUserMedia` with `chromeMediaSourceId` — capture a specific window without an OS dialog
- `beehive-ctl` (`electron/beehive-ctl.m`) — native ObjC helper with two modes, dispatched by argv[1]:
  - `activate-window <cgWindowNumber>` — one-shot: resolves the owning app's PID via `CGWindowListCopyWindowInfo` and brings it to the foreground via `NSRunningApplication activateWithOptions:`; invoked via `execFile`, no persistent process, no special permission required
  - `watch-clicks` — long-running, spawned via `spawn` for as long as the Floating Control Dock is shown: polls `CGEventSourceButtonState()` (is the left mouse button physically down?) and `NSEvent.mouseLocation` at ~120 Hz, streaming each down/up transition as a JSON line (`{"type":"down"|"up","x":...,"y":...}`) until killed. A hardware-state poll rather than an event tap/monitor, so it needs no special permission — an earlier `NSEvent` global-monitor version silently never fired because modern macOS gates that behind Input Monitoring — see the Floating Control Dock section above for the full story
- A second `BrowserWindow` (`electron/dock.html` + `dockPreload.cjs`) — the always-on-top Control Dock; `contextBridge.exposeInMainWorld('dockAPI', …)` exposes a separate, narrower bridge for that window
- `contextBridge.exposeInMainWorld('electronAPI', …)` — secure renderer bridge for the main window

**Running the desktop app (dev):**
```bash
npm run electron:dev
# Starts: backend (:3001) + Vite frontend (:5173) + Electron window
```

**Building a distributable:**
```bash
npm run electron:build:mac   # → release/BeeHive-universal.dmg  (Apple Silicon + Intel, one file)
npm run electron:build:win   # → release/BeeHive-Setup.exe (combined x64+arm64 NSIS installer)
```

**Universal macOS build — Apple Silicon + Intel in one installer:** `electron:build:mac` runs `electron-builder --mac --universal`, which builds the app once per architecture (arm64 and x64), then `lipo`-merges every Mach-O binary in the bundle into a single fat binary via `@electron/universal` (bundled with electron-builder — no extra dependency needed). One `.dmg` runs natively on both, no separate installers, no runtime architecture branching.
- **Root cause this fixes**: `package.json`'s `build.mac` previously had no `arch` setting at all, so electron-builder defaulted to whatever architecture the *build machine* happened to be (arm64, since builds have only ever been run on Apple Silicon here) — every published installer was silently arm64-only, and would not launch at all on an Intel Mac.
- **A second, independent arm64-only binary had to be fixed too**: `electron/beehive-ctl.m` (the native helper behind the click-through floating dock — see the dock section above) is compiled by `npm run build:ctl` via a direct `clang` invocation, which also defaulted to the host machine's architecture with no `-arch` flags. Even with the Electron shell itself made universal, this bundled helper would still have been arm64-only and failed to launch on Intel (an arm64 binary cannot run on Intel hardware — Rosetta only translates the other direction, x86_64 → arm64, never arm64 → x86_64). Fixed by building it explicitly for both: `clang ... -arch x86_64 -arch arm64 ...`. Verified directly with `lipo -info` on the compiled binary: `x86_64 arm64`.
- **A packaging misconfiguration blocked the universal merge outright**: the first universal build attempt failed with `@electron/universal` refusing to merge, because `node_modules/@rolldown/binding-darwin-arm64/*.node` (Vite 8's native Rust bundler binary) was present in the arm64 build's `app.asar.unpacked` but not the x64 build's — an arch-specific native binary that's identical-looking-but-arch-mismatched trips `@electron/universal`'s safety check by design. `vite` and `@vitejs/plugin-react` are pure build-time tooling — the shipped app only ever runs `dist/**` static output + the bundled backend, it never imports Vite at runtime — so this native binary had no business being packaged at all.
  - **First attempt (wrong): moved `vite`/`@vitejs/plugin-react` to `devDependencies`.** This fixed the Electron packaging (electron-builder's dependency-tree walk excludes devDependencies by default) but **broke the Render web deploy**: `render.yaml` sets `NODE_ENV=production`, and npm's documented behavior is to skip installing `devDependencies` entirely whenever that's set — so Render's `npm install` no longer installed `vite` at all, and the subsequent `npm run build` (→ `vite build`) failed outright with `sh: vite: command not found` (exit 127). Confirmed directly: reproduced Render's exact failure locally with `NODE_ENV=production npm install`.
  - **Actual fix: keep `vite`/`@vitejs/plugin-react` in `dependencies`** (Render's production install needs them to run `vite build` at all) **and exclude them from the Electron package explicitly**, via negation globs in `package.json`'s `build.files` (`!node_modules/vite/**`, `!node_modules/@vitejs/**`, `!node_modules/rolldown/**`, `!node_modules/@rolldown/**`, `!node_modules/lightningcss/**`, `!node_modules/lightningcss-*/**`) rather than relying on the dependencies/devDependencies split, which turned out to serve two genuinely conflicting needs (Render's build needs Vite *installed*; the packaged Electron app needs it *excluded*) that no single classification can satisfy at once.
  - Verified both fixed simultaneously: `NODE_ENV=production npm install && npm run build` succeeds in a clean checkout (matching Render exactly), and the Electron universal build still produces a clean merge — confirmed via `find` that no `rolldown`/`lightningcss` files exist anywhere inside the packaged `.app`, and `lipo -info` still reports `x86_64 arm64` on the main executable.
- **Verified end-to-end, not just configured**: ran the actual `electron:build:mac` build after both fixes and confirmed via `lipo -info` that both the main Electron executable and the bundled `beehive-ctl` helper inside the produced `.app` report `x86_64 arm64`; confirmed `codesign -d --entitlements -` still shows the camera/microphone entitlements after the universal merge's re-sign step (the ad-hoc-signing `afterSign.cjs` hook fires once, on the final merged app, not per-arch — confirmed from the build log); confirmed `codesign --verify --deep --strict` passes on both the freshly-built and the `/Applications`-installed copy; installed and launched the resulting app on this (Apple Silicon) machine to confirm no regression. Real Intel hardware wasn't available to test the x86_64 slice directly in this environment — flagged honestly rather than claimed.
- **Size trade-off, expected and unavoidable**: the universal `.dmg` is ~241MB vs. ~155MB for the old arm64-only build. This is inherent to what a universal binary *is* (both architectures' compiled code shipped side by side, not a redundancy to trim) — not a regression introduced by this fix.
- Because the artifact filename is now `BeeHive-universal.dmg` (electron-builder's `${arch}` template resolves to `universal`), `DesktopHandoff.tsx`'s `NATIVE_MAC_DMG_URL` was updated to match — otherwise the download link would 404 exactly as it did when the filename scheme last changed (see the Download section above). The web UI's earlier best-effort Apple-Silicon-vs-Intel *detection* (added to honestly warn Intel visitors away from a broken arm64-only download) was removed entirely along with this fix: with one universal installer working on every Mac, there's nothing left to detect or warn about.

**App versioning — a committed count, not a live git query:** the version shown in the app (bottom-right corner, next to "Built by X Spark" — see `BuiltByFooter.tsx`) and baked into every packaged build is `1.0.<total commit count>`, e.g. `1.0.197` for a repo with 197 total commits.
- **Computed by `scripts/appVersion.mjs`**: `getAppVersion()` reads `scripts/version-count.json` (`{ "count": 197 }`) and returns `1.0.${count}` — a plain committed file, not a `git rev-list` run at build time. `getAppSha()` still runs `git rev-parse --short HEAD` live (the exact commit a build came from, for cases where that matters more than the count) — only the *count* moved off live git, for the reasons below.
- **For the web app**: `vite.config.ts` imports both and injects them via `define: { 'import.meta.env.VITE_APP_VERSION': ..., 'import.meta.env.VITE_APP_SHA': ... }` — a real build-time constant, not a runtime lookup, so it works identically in dev and in the deployed production bundle. `BuiltByFooter.tsx` renders it in dim grey (`v1.0.197`) beside the brand credit.
- **For the desktop app**: `package.json`'s `electron:build:mac` / `electron:build:win` scripts append `-c.extraMetadata.version=$(node scripts/appVersion.mjs)` to the `electron-builder` invocation, which overrides the packaged app's `version` field (shown in About panels, DMG metadata, etc.) without ever writing a new number into `package.json` on disk.
- **Why not a capped/odometer scheme** (e.g. counting 0–9 per digit before carrying, so the major/minor climb automatically): considered and rejected — semver's major/minor numbers are supposed to mean something (breaking change, new feature) decided by a human, and an automatic carry would fabricate meaningless version bumps. `1.0.<count>` keeps `1.0` as a deliberate, human-controlled baseline and lets only the patch-equivalent digit climb automatically; moving to `2.0.0` later is a one-line manual edit to `getAppVersion()`'s template whenever an actual breaking change warrants it.
- This has no relationship to the desktop installers' *filenames* (`BeeHive-universal.dmg` / `BeeHive-Setup.exe`), which are deliberately version-less/stable so the GitHub `releases/latest/download/...` links never go stale — see the Download section above.
- **Three real bugs, in order, that led here** (each found on the actual deployed site, not assumed):
  1. **Branch-relative undercount**: the count originally came from `git rev-list --count HEAD`, which only counts commits reachable from *whichever branch is checked out* — this repo's own branches showed wildly different numbers for the same history (`main` → 1, `develop` → 20, `staging` → 193+), so a build from the wrong branch would show a nonsensical version. Switched to `git rev-list --count --all` (every ref, not just HEAD) to make the number branch-independent — verified by checking out both `main` and `staging` and confirming `--all` reported the identical number on both.
  2. **Shallow-clone undercount survived that fix**: Render's build clones with `git clone --depth 1`, so even `--all` only sees the one commit actually present — no error, just silent undercounting. Tried detecting a shallow checkout and running `git fetch --unshallow` before counting.
  3. **The unshallow fix didn't actually work on Render**: the deployed site kept showing `v1.0.1` even *after* that fix shipped, confirmed by checking that the live bundle contained code from commits well after the fix — meaning Render's build container was never successfully unshallowing at all, almost certainly restricted network egress during the build step, silently swallowed by the script's own error handling. **A number computed at build time is fundamentally at the mercy of however much git history the deploy environment happens to make available** — not something this repo controls, and apparently unreliable on Render specifically. Moved the count itself into a **committed file** (`scripts/version-count.json`) that's refreshed and committed alongside meaningful changes, so any deploy environment — shallow, offline, whatever — just reads a plain static number with zero git dependency. Verified directly: ran `node scripts/appVersion.mjs` in a copy of the repo with `.git` removed entirely and got the correct version back.

**Code signing / entitlements (macOS, important):** this project has no paid "Developer ID Application" certificate, so `electron-builder` **skips code signing entirely** for every mac build — and skipping signing also means it skips applying `hardenedRuntime` + `entitlements.mac.plist`, even though both are configured in `package.json`'s `build.mac`. A build in that state has **zero entitlements at all**: no `com.apple.security.device.camera`/`microphone`, so macOS TCC silently denies camera/mic access to the packaged app — no error, no prompt, the buttons just don't work, which is easy to misdiagnose as an app bug rather than a packaging one. `electron/afterSign.cjs` (wired via `build.afterSign`) fixes this automatically: it checks for a real Developer ID identity, and if none is found (the case here), ad-hoc re-signs the app with `entitlements.mac.plist` itself, before the DMG is packaged (so the DMG's contents are correct too, not just the raw `.app`). If a paid certificate is ever added to this machine, the hook detects it and steps aside rather than overwriting a proper signature. For the universal build specifically, this hook fires exactly once, against the final `lipo`-merged app (not once per architecture) — confirmed from the build log — since merging two already-signed per-arch apps invalidates their individual signatures, and only the merged result is what's actually shipped.

**Installing the built app (macOS):**
1. Open `release/BeeHive-universal.dmg`
2. Drag BeeHive to Applications
3. First launch: **right-click BeeHive → Open** (then confirm in the dialog). This bypasses Gatekeeper once and remembers the choice — needed because the app is ad-hoc signed, not notarized (no paid Apple Developer ID). A plain double-click is blocked.
   - **If macOS says the app is "damaged" instead** (can happen for an ad-hoc-signed app that the browser quarantined on download), strip the quarantine flag once: `xattr -dr com.apple.quarantine /Applications/BeeHive.app`, then open normally. This is the guaranteed fallback when right-click → Open isn't enough.
4. If multiple instances appear in the dock, quit all and relaunch once; the single-instance lock prevents duplicates from v1.0.0 onward

**API routing in packaged builds:**
In dev the Vite server proxies `/api/*` → `:3001`. In the packaged `.app` there is no Vite proxy — all `fetch` calls use `http://localhost:3001` directly (detected via `window.electronAPI`). The embedded backend still binds to `:3001` on launch.

**Invite links in the desktop app:**
The Electron app loads from `file://` so `window.location.href` would produce broken links like `file:///?room=...`. All invite link generation uses `VITE_WEB_BASE_URL` (set in `.env`) so copied links always point to the production web app (`https://beehive-fu8w.onrender.com?room=ROOM_ID`). Guests open the link in any browser — no desktop app required.

**Magic link deep-link (Electron):**
Supabase sends magic links with `emailRedirectTo: beehive://auth/confirm`. When clicked, macOS routes the URL to Electron via the registered `beehive://` URL scheme. `main.cjs` catches it via `open-url` (macOS) or `second-instance` argv (Windows), extracts the token hash, and loads `/?auth=confirm#<token>` in the renderer so Supabase's `detectSessionInUrl` processes it automatically.

---

### Fathom Integration

BeeHive connects to [Fathom](https://fathom.video) for AI meeting intelligence.

**Features (Lobby → "Recent meetings"):**
- Meeting list — title, date, duration, attendees
- AI-generated summary — rendered by a small purpose-built markdown renderer (`FathomPanel.tsx`'s `FathomSummary`/`renderInline`/`renderBold`), not a general markdown library. Fathom's `default_summary.markdown_formatted` field is real markdown (`##`/`###` headers, `**bold**` — including bold nested inside link text — `[text](url)` links, `  - ` bullets), and was previously dumped into a plain `<div>` as literal text, so summaries showed raw `##`/`**`/`[...]( ...)` syntax instead of clean formatted prose. The renderer covers exactly the subset confirmed present in real API responses (verified by fetching live data and scanning for any other markdown syntax — tables, code fences, numbered lists, italics — none found); action items and transcript lines are plain text from the API and need no such handling
- Action items with assignee and completion status
- On-demand transcript viewer
- "Open in Fathom ↗" deep-link
- Cursor-based pagination ("Load more")

**API:** `https://api.fathom.ai/external/v1` — proxied through Node.js backend (API key never reaches client).  
**Required env var:** `FATHOM_API_KEY`  
**Note on `limit`:** Fathom's `/meetings` endpoint appears to enforce its own floor of 10 results regardless of a smaller requested `limit` — confirmed by calling Fathom's API directly with the same key, bypassing this app's proxy entirely, and seeing the same behavior. Not a bug in this codebase; the proxy forwards the client's `limit` correctly.

---

### Security
- **HTTP security headers** (`livekit_node_backend.js` middleware, applied to every response) — `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. **Must live here, not in `render.yaml`**: Render's declarative `headers:` config only applies to `runtime: static` services — this is `runtime: node` with a custom `startCommand`, so a `headers:` block there is silently ignored (this is why the live site scored an F on header scans despite an earlier attempt having put them there — see the callout in `render.yaml`). The CSP's `script-src` is `'self'` with no `unsafe-inline`: the one inline `<script>` `index.html` used to have (viewport zoom-to-fit / `--vh` setup) was externalized to `public/viewport-init.js` specifically so this could be avoided; `style-src` does need `'unsafe-inline'`, because a few components (`RoomPage.tsx`, `Toast.tsx`) render genuine inline `<style>{...}</style>` blocks for keyframes/hover rules — CSP `unsafe-inline` for styles can't execute script, so this is a low-risk, deliberate allowance rather than an oversight. `connect-src`/`script-src` explicitly allow the exact external hosts the app actually loads from (Supabase, LiveKit Cloud, `cdn.jsdelivr.net` + `storage.googleapis.com` for MediaPipe) — audited via a full-codebase grep for every external URL reference, not guessed
- Row Level Security (RLS) on all Supabase tables — including `usage` and `audit_logs`, which shipped in the base schema without it (Supabase's advisor flagged `usage` as publicly readable/writable; `audit_logs` had the identical gap). Fixed via `supabase/migrations/002_enable_rls_usage_audit_logs.sql`. Neither table is touched by any client-side code, so RLS-with-no-policies (default-deny) is correct — there's no legitimate client read/write case to add a policy for
- **Default grants revoked too** — RLS-with-no-policies already denies `anon`/`authenticated` regardless of table grants, but both roles still held Supabase's default full CRUD grants on `usage`/`audit_logs`, leaving RLS as the only barrier. `supabase/migrations/003_revoke_public_grants_usage_audit_logs.sql` revokes those grants as defense-in-depth, so a future permissive policy added to either table by mistake still wouldn't expose them
- Passwordless auth — no password storage, no brute-force surface
- Anon-safe participant tracking (no login required for `?room=` invite links)
- Fathom API key proxied through backend (never reaches client)
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` only
- `beehive://` deep-link handler validates token structure before loading into renderer
- **Unique per-connection LiveKit identity** — the client generates a random UUID as each participant's LiveKit `identity` (`livekit_react_hooks.tsx`'s `useJoinRoom`), sent alongside `displayName` to `/api/livekit/token`. Freeform display names collide easily (two tabs sharing one signed-in profile, two people typing the same name), and LiveKit disconnects the earlier participant whenever a second one joins with an identity already in use — this surfaced as "their mic doesn't work" with no visible error. `displayName` is still used for LiveKit's `name` field (what's shown in the UI); the `participant_left` webhook matches on `participant.name` accordingly, not `participant.identity`

---

## Backend API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/rooms/schedule` | Create a waiting-room-gated scheduled room; body: `{ name, organisation }`; returns `{ room, hostSecret }` — see [Waiting Room](#waiting-room--host-delegated-admit-rights-scheduled-meetings-only) |
| `POST` | `/api/livekit/token` | Generate LiveKit JWT; body: `{ roomName, displayName, identity, hostSecret? }` — `identity` is a client-generated UUID (falls back to `displayName` if omitted, for older clients); see [Security](#security). On a `requires_admission` room without a valid `hostSecret`, responds **202** `{ status: 'pending', requestId }` (no token) instead of issuing one, or **403** if previously denied |
| `POST` | `/api/rooms/:roomId/admit` | Admit or deny a waiting attendee; body: `{ requestId, decision: 'admit'\|'deny', actingDisplayName?, hostSecret? }` — authorized via a matching `hostSecret` or an already-admitted `host`/`co-host` role |
| `POST` | `/api/rooms/:roomId/grant-co-host` | Delegate (or revoke) admit rights; body: `{ displayName, grant, hostSecret }` — requires `hostSecret` specifically, not just a role check |
| `POST` | `/api/livekit/webhook` | LiveKit webhook receiver (`egress_ended`, `participant_left`, `room_finished` — the last one ends a room server-side even when every client disconnected ungracefully) |
| `GET` | `/api/fathom/meetings` | Proxy to Fathom meetings list; query: `limit`, `cursor`, `created_after` |
| `GET` | `/api/fathom/recordings/:id/transcript` | Proxy to Fathom transcript for a recording |
| `GET` | `/health` | Health check — `{ status: 'ok' }` |

> File uploads go directly from the browser to **Supabase Storage** using the anon key — no backend route needed.

---

## Project Structure

```
beehive/
├── src/
│   └── main.tsx                        # React entry — wraps app in <AuthGate>
├── RoomPage.tsx                        # Root router (RoomPage) + MeetingRoom
├── components/                         # UI components & shared modules
│   ├── AuthGate.tsx                    #   auth wrapper; ?room= bypasses gate
│   ├── AuthScreen.tsx                  #   magic link + OTP sign-in / register UI
│   ├── InviteModal.tsx                 #   plain ?room=ROOM_ID link + copy button
│   ├── Lobby.tsx                       #   lobby (Start Now / Schedule + card-flip register)
│   ├── SchedulePanel.tsx               #   schedule + duration + email-invite panel
│   ├── TimePicker.tsx                  #   cross-browser 24h time dropdown (Safari has no native one)
│   ├── MeetingPrep.tsx                 #   Smart Meeting Preparation (type cards + prep panel)
│   ├── meetingTemplates.ts             #   meeting-type template data (agenda/docs/questions/…)
│   ├── MeetingPrepWindow.tsx           #   in-meeting floating prep checklist/agenda (collapsible)
│   ├── Toast.tsx                       #   self-dismissing confirmation banner (e.g. "Meeting set up successfully")
│   ├── WaitingRoom.tsx                 #   full-screen "waiting for the host" view (scheduled meetings)
│   ├── AdmissionRequestsWindow.tsx     #   host/co-host floating panel — admit/deny waiting attendees
│   ├── FullscreenHud.tsx               #   floating attendees/hands/reactions/controls panel — full-screen mode only
│   ├── FathomPanel.tsx                 #   Fathom meetings + FathomMeetingRow
│   ├── ParticipantsWindow.tsx          #   draggable/dockable window + horizontal strip; host-only co-host toggle
│   ├── BackgroundMenu.tsx              #   background-effects menu
│   ├── AutoCamWindow.tsx               #   auto-cam floating window
│   ├── SpeakingIndicator.tsx           #   active-speaker chip + video (dual-window in presentation mode)
│   ├── ScreenShareMenu.tsx             #   pre-share menu
│   ├── ScreenShareBar.tsx              #   active-share bar
│   ├── ElectronWindowPicker.tsx        #   desktop window picker
│   ├── ReactionComposer.tsx            #   long-press emoji reaction composer popover
│   ├── DesktopHandoff.tsx              #   web → desktop sign-in handoff + OS-aware download link
│   ├── BuiltByFooter.tsx               #   shared "Built by X Spark" credit (sign-in + lobby)
│   ├── segmentation/                   #   virtual-background segmentation engines
│   │   ├── types.ts                    #     SegmentationEngine interface
│   │   ├── tasksVisionEngine.ts        #     MediaPipe Tasks Vision adapter (GPU-delegated)
│   │   ├── legacyEngine.ts             #     legacy MediaPipe Selfie Segmentation (fallback)
│   │   └── createSegmentationEngine.ts #     tries Tasks Vision, falls back to legacy
│   ├── roomUtils.ts                    #   constants, helpers, drawVirtualScene
│   └── roomStyles.ts                   #   shared `s` styles object
├── livekit_react_hooks.tsx             # Hooks: useAuth, useProfile, useCreateRoom,
│                                       #   useJoinRoom, useRoomInfo, useParticipants,
│                                       #   useChat, useRecordings, useFathomMeetings,
│                                       #   useFathomTranscript
├── livekit_node_backend.js             # Express API: LiveKit token generation,
│                                       #   LiveKit webhook receiver, Fathom proxy
├── supabase/
│   └── migrations/
│       ├── 001_auth_system.sql         # Auth schema additions (applied)
│       ├── 002_enable_rls_usage_audit_logs.sql         # RLS fix — see Security (applied)
│       ├── 003_revoke_public_grants_usage_audit_logs.sql # Grant revocation — see Security (applied)
│       └── 004_waiting_room.sql        # rooms.requires_admission, room_hosts, admission_requests (applied)
├── scripts/
│   └── seed-dev.js                     # Create 6 X Spark dev users via Supabase Admin API
├── electron/
│   ├── main.cjs                        # Electron main — beehive:// URL scheme + deep-link handler
│   ├── preload.cjs                     # contextBridge — exposes electronAPI
│   ├── beehive-ctl.m                   # native helper — activate a window by CGWindowNumber; watch-clicks (button-state poll for the click-through dock)
│   ├── dock.html                       # Floating Control Dock UI (plain HTML/JS, separate window)
│   ├── dockPreload.cjs                 # contextBridge — exposes window.dockAPI to dock.html
│   ├── entitlements.mac.plist          # macOS hardened runtime entitlements
│   └── afterSign.cjs                   # electron-builder hook — ad-hoc re-sign w/ entitlements when unsigned
├── assets/
│   └── icon.icns                       # macOS app icon
├── livekit_supabase_schema.sql         # Base Supabase schema
├── livekit_database_recommendation.md  # ADR: Supabase vs Firebase
├── index.html                          # App shell + Roboto font + viewport-init.js + module entry
├── public/                             # Static assets served as-is by Vite
│   └── viewport-init.js                #   --vh + zoom-to-fit (externalized from index.html for CSP script-src)
├── vite.config.ts                      # base: './' for Electron file:// compat
├── package.json                        # main: electron/main.cjs; build config
├── render.yaml                         # Render deploy config — see Deployment below
└── .env                                # Local secrets (git-ignored)
```

---

## Deployment

The live web app deploys via [Render](https://render.com) ([`render.yaml`](./render.yaml)):

- **Branch**: `staging` — every push auto-deploys (this is also the branch used for local development; `main` is not currently kept in sync and should not be assumed to reflect the live site)
- **Build**: `npm install && npm run build` (Vite build → `dist/`)
- **Start**: `node livekit_node_backend.js` — the same Express server that also serves the built frontend as static files in production (see `livekit_node_backend.js`'s `SERVE FRONTEND` section)
- **Env vars**: configured in the Render dashboard (`sync: false` in `render.yaml`), not committed — see [Environment Variables](#environment-variables) for the full list
- Live URL: `https://beehive-fu8w.onrender.com` (also `VITE_WEB_BASE_URL`, used for invite-link generation)

---

## Database Schema

**Base tables** ([`livekit_supabase_schema.sql`](./livekit_supabase_schema.sql)):

| Table | Purpose |
|-------|---------|
| `users` | Legacy user profiles (email, name, org); bridged to auth via `auth_user_id` |
| `rooms` | Meeting rooms with LiveKit room names |
| `room_participants` | Real-time participant tracking (anon-safe; `auth_user_id` set for authenticated users) |
| `chat_messages` | In-meeting chat + file share notifications |
| `recordings` | Recording metadata |
| `usage` | Billing/analytics tracking |
| `audit_logs` | Compliance + debugging (`auth_user_id` included) |

**Auth tables** ([`supabase/migrations/001_auth_system.sql`](./supabase/migrations/001_auth_system.sql)):

| Table | Purpose |
|-------|---------|
| `profiles` | Canonical post-auth identity (`id = auth.users.id`); `full_name`, `avatar_url`; auto-created on signup via trigger |
| `roles` | `admin` / `user` roles |
| `user_roles` | User ↔ Role junction; default `user` role assigned on signup |
| `invitations` | *(legacy)* Tokenised invitation schema — table still exists in the migration, but the app no longer reads/writes it; invites are now plain `?room=ROOM_ID` links (see [Invitations](#invitations)) |

**Waiting room tables** ([`supabase/migrations/004_waiting_room.sql`](./supabase/migrations/004_waiting_room.sql)):

| Table | Purpose |
|-------|---------|
| `rooms.requires_admission` | New column, default `false`. `true` only on rooms created via `POST /api/rooms/schedule` — the explicit signal the shared join path (`useJoinRoom`) uses to decide whether to gate a room at all |
| `room_hosts` | `room_id` → `host_secret`. RLS enabled with **zero policies** — completely inaccessible to `anon`/`authenticated` (and their default table grants are explicitly revoked too, defense-in-depth), reachable only via the backend's service-role client |
| `admission_requests` | Pending/admitted/denied join requests, keyed uniquely by `(room_id, identity)`. SELECT/INSERT permissive, **no UPDATE policy for anon/authenticated at all** — status only ever changes via `POST /api/rooms/:roomId/admit` |

---

## Architecture

```
React Frontend (Vite — default :5173)
        │
        ├── AuthGate → AuthScreen (magic link / OTP via Supabase Auth)
        │
        ├── Supabase (state, RLS, Realtime)
        │         └── PostgreSQL — rooms, participants, chat, recordings,
        │                          profiles, roles, user_roles
        │         └── Storage — shared-files bucket (file uploads)
        │
        └── /api/* → Node.js Backend (:3001)
                        ├── LiveKit Server SDK — token generation
                        │         └── LiveKit Cloud — media (WebRTC)
                        ├── LiveKit webhook receiver — recordings, participant-left
                        └── Fathom API proxy — meeting intelligence

Electron (desktop)
        ├── main.cjs — BrowserWindow + IPC handlers
        │         ├── shell.openPath()        — open presentation files natively
        │         ├── desktopCapturer         — enumerate windows for screen share
        │         └── beehive:// URL scheme   — intercept magic-link redirects
        └── preload.cjs — contextBridge → window.electronAPI
```

**Presentation share flow (Electron):**
1. Drop `.pptx` / `.key` → `shell.openPath(file.path)` launches app
2. User enters slideshow mode
3. Click "Share Presentation" → `desktopCapturer.getSources()` → keyword match
4. Thumbnail preview shown (amber border) → user confirms
5. `getUserMedia({ chromeMediaSourceId })` → `replaceTrack` on LiveKit screen share track

---

## Environment Variables

```env
# Fathom
FATHOM_API_KEY=your_fathom_api_key

# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Supabase (server-side — Node.js backend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Supabase (client-side — Vite prefix required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud

# App
VITE_WEB_BASE_URL=https://beehive-fu8w.onrender.com   # Used for invite link generation in Electron
PORT=3001

# Desktop app download links (optional — both default to the GitHub Releases
# page if unset; see "Download the desktop app" under Authentication)
VITE_DESKTOP_DOWNLOAD_MAC_URL=https://github.com/SaphoM/beehive/releases/latest
VITE_DESKTOP_DOWNLOAD_WIN_URL=https://github.com/SaphoM/beehive/releases/latest
```

**Supabase Dashboard settings required:**
- Authentication → URL Configuration → **Site URL**: `https://beehive-fu8w.onrender.com`
- Authentication → URL Configuration → **Redirect URLs**: `https://beehive-fu8w.onrender.com/**`, `http://localhost:5173/**`

**Seeding dev users (first-time setup):**
```bash
node scripts/seed-dev.js
# Creates 6 X Spark team accounts (email_confirm=true — no verification email)
# Promotes sapho@xspark.co.za to admin automatically
```

---

## Mobile Web Responsive Design

BeeHive's in-meeting UI is fully responsive for mobile browsers (iOS Safari, Android Chrome).

### Viewport Zoom-to-Fit

The page uses a **fixed 375 px design width** (iPhone SE / 13 mini — the smallest modern phone) and scales the viewport `initial-scale` on load so the layout fills any phone screen exactly, with nothing cut off:

```
375 px device  →  scale 1.00  (SE, 13 mini)
390 px device  →  scale 1.04  (iPhone 13, 14)
393 px device  →  scale 1.05  (iPhone 14 Pro, 15)
430 px device  →  scale 1.15  (iPhone 13/14 Pro Max)
```

Tablet and desktop (> 640 px) revert to `width=device-width, initial-scale=1.0`.

Implemented via a synchronous `<script>` in `index.html` (before React loads) that reads `window.screen.width` and sets the `<meta name="viewport">` content. Re-applied on `orientationchange`.

### iOS Safari Viewport Height (`--vh`)

iOS Safari's `100vh` includes the browser chrome (address bar + toolbar), so layout using `height: 100vh` would extend behind the UI. BeeHive sets a `--vh` CSS custom property equal to `window.innerHeight` (the real available height) on load, resize, and orientation change. All full-screen containers use `height: var(--vh, 100vh)` instead.

### Breakpoints

| Variable | Threshold | Used for |
|----------|-----------|---------|
| `isMobile` | `≤ 640 px` | Switch to mobile controls bar, compact header, floating timer |
| `isSmallPhone` | `≤ 430 px` | 40 px buttons, tighter gaps, count-only participant pill |

### Safe-Area Clearance

Controls bar bottom padding: `calc(env(safe-area-inset-bottom, 0px) + 72px)` — clears the home indicator (34 px on iPhone 13+) plus browser toolbar.

Speaking indicator bottom: `calc(env(safe-area-inset-bottom, 0px) + 130px)` — clears the controls bar.

### Mobile-Only / Desktop-Only Features

| Feature | Mobile | Desktop |
|---------|--------|---------|
| Laser pointer | Hidden (needs mouse cursor) | Visible |
| Pop-out presentation | Hidden (no multi-window on mobile) | Visible |
| Participant window popup | Hidden (main grid is primary view) | Clickable pill |
| Floating timer | Shown in video area | Shown in header |
| Chat / Stop Sharing | In `+` More panel | In header |

---

## Running Locally

**Web (two terminals):**
```bash
# Terminal 1
npm run dev:backend     # → BeeHive backend on :3001

# Terminal 2
npm run dev:frontend    # → http://localhost:5173
```

> **Port note:** BeeHive owns port **5173**. If another project also uses Vite on 5173, move that project's `.claude/launch.json` to a different port (e.g. 5174) to avoid conflicts.

> **`npm install` also runs a full build** — `postinstall` runs `npm run build` (`vite build` → `dist/`) automatically after every install. This is what lets `livekit_node_backend.js` serve a working `dist/` in production without a separate manual build step, but it does mean a fresh `npm install` takes noticeably longer than just resolving dependencies.

**Desktop app:**
```bash
npm run electron:dev
# Starts backend + Vite + Electron window in one command (concurrently)
# Electron loads http://localhost:5173
```

---

## Branch Strategy

| Branch | Purpose | Merges into |
|--------|---------|-------------|
| `main` | Production | — |
| `staging` | Client / UAT testing | `main` |
| `develop` | Integration / internal testing | `staging` |
| `feature/*` | New features | `develop` |
| `bugfix/*` | Non-critical fixes | `develop` |
| `hotfix/*` | Emergency production fixes | `main` + `develop` |

---

## Supabase Project

- **Project:** X Spark LiveKit
- **Region:** eu-west-1
- **Dashboard:** [supabase.com](https://supabase.com) → X Spark org

---

## GitHub Repository

[github.com/SaphoM/beehive](https://github.com/SaphoM/beehive)

---

## Planned: Host Controls & Group Management

> Accessed from the Participants window. Only available to the room host / co-host role.

The `host`/`co-host` role this section assumes now actually exists (see [Waiting Room & Host-Delegated Admit Rights](#waiting-room--host-delegated-admit-rights-scheduled-meetings-only) under Features) — everything below (mute controls, groups, breakaways) is still unbuilt and would layer on top of it.

### Mute Controls

| Action | Scope | Description |
|--------|-------|-------------|
| Mute one | Individual | Host clicks a participant's mic icon to mute them |
| Mute all | Room-wide | Single action to mute every participant at once |
| Select + mute | Multi-select | Checkbox-select multiple attendees, then mute selection |

---

### Group System

Participants can be organised into named groups within a room.

**Labels:** Auto-assigned on join as `Group 1`, `Group 2`, `Group 3`, etc. Host can rename any group.

| Action | Description |
|--------|-------------|
| Assign to group | Drag participant tile onto a group, or use dropdown |
| Rename group | Click group label to edit inline |
| Mute group | Mutes all participants in that group |
| Break away discussion | Sends a group into a temporary sub-room |

---

### Breakaway Discussions

A **breakaway** moves a group into a temporary LiveKit sub-room, isolated from the main room.

**Flow:**
1. Host selects a group → **"Break Away"** button
2. Modal: choose duration (5 / 10 / 15 / 30 min, or custom) → confirm
3. Sub-room created (`{livekit_room_name}-group-{n}`) — participants auto-join
4. Countdown displayed in sub-room header
5. On expiry (or manual recall): participants rejoin main room

**Database impact:**
- New `breakaway_sessions` table: `room_id`, `group_id`, `livekit_sub_room`, `duration_minutes`, `started_at`, `ends_at`

---

## Roadmap

- [x] Authentication — Magic Link + Email OTP (no passwords); AuthGate; frictionless `?room=` join; post-meeting register CTA with card-flip animation
- [x] Invitation system — plain `?room=ROOM_ID` links, open to anyone, no account required; `InviteModal` in meeting controls (superseded the earlier tokenised-invitation backend, which has been removed)
- [x] User roles — `admin` / `user`; auto-assigned on signup; `is_admin()` RLS helper
- [x] Electron deep-link — `beehive://` URL scheme intercepts magic-link redirects
- [x] Web → desktop sign-in handoff — "Open in desktop app" button on the web lobby hands off the live session via `beehive://` (web-only, optional)
- [x] Desktop app download link — OS-aware "Download for macOS/Windows" fallback beneath the handoff button (excludes touch devices, incl. iPadOS); link target configurable via env, defaults to GitHub Releases
- [x] Background-noise suppression — Krisp noise filter on the mic (lazy-loaded, ~5–6 MB payload split into its own chunk so it never affects initial page load)
- [x] Host role — waiting room + host-delegated admit rights, scheduled meetings only (`host`/`co-host`/`participant` on `room_participants.role`, gated join in `/api/livekit/token`, `WaitingRoom` + `AdmissionRequestsWindow`); Start Now stays fully frictionless
- [ ] Recover "host" status if the creator's browser/localStorage is lost (no recovery flow yet — see the Waiting Room section under Features)
- [ ] Mute controls, group system, breakaway discussions — the rest of "Planned: Host Controls & Group Management" below, not yet built
- [ ] Mute controls — individual, mute all, multi-select mute
- [ ] Group system — auto-labelled, renameable, group mute
- [ ] Breakaway discussions — timed sub-rooms with auto-recall
- [x] Screen sharing (Entire Screen / Select Window / Switch source / Clear screen mode / echo-free web share / Electron no-dialog capture)
- [x] Fullscreen — expand the main area to fill the entire screen (web + desktop)
- [x] Pop-out — detach the shared presentation into a separate window (web + desktop, viewer + presenter)
- [x] Laser pointer — broadcast your cursor to all participants over Supabase Realtime
- [x] Presenter slide control — drive Keynote / PowerPoint from the main area & fullscreen (macOS desktop, AppleScript)
- [x] Click-to-focus for window shares — click the preview to bring the shared window forward (native window activation, no injection); persistent "You're sharing" indicator with elapsed time + Stop
- [x] Floating always-on-top Control Dock — mic, camera, raise hand, slide nav, chat (unread badge), participants (count), stop sharing, leave, meeting/share timers, active-speaker name, connection-quality dot — visible above any foreground app while presenting a window
- [x] Meeting ended state — last-to-leave marks room ended; invite link shows summary card, blocks re-join
- [x] Join / leave notifications in chat
- [x] Auto-end when alone for 10 minutes (countdown banner with Stay option)
- [x] Speaking indicator + floating speaker video window (Minimise / Close)
- [ ] Recording playback UI
- [ ] DUT organisation SSO
- [ ] Syspro integration (government contracts)
- [x] Mobile web responsive — zoom-to-fit viewport, iOS safe-area, small-phone button sizing, no horizontal overflow (all modern iPhone sizes)
- [ ] Mobile native app (React Native + LiveKit mobile SDK)
- [x] Fathom integration — meeting summaries, action items, transcript viewer
- [x] Background effects — Blur / Image upload / Virtual scenes; MediaPipe Tasks Vision segmentation (GPU-delegated) with automatic fallback to the legacy MediaPipe API; aspect-ratio-correct output (no stretch), overscan blur (no vignette), feathered + temporally-smoothed attendee cutout (no hard cutout/halo), portrait-lens depth-of-field falloff on the Blur background, subtle background color match + foreground contrast
- [x] File sharing — drag-to-drop or paperclip; send to all or select attendees; Supabase Storage
- [x] Schedule meeting — date/time/duration picker, email chip invites, shareable link, mailto integration
- [x] Smart Meeting Preparation (v1) — ~21 meeting-type cards; per-type agenda/checklist/questions/goals/attendees/risks; editable agenda + interactive checklist (add/remove/custom); live readiness score + prep-time estimate; rule-based recommendations (agenda-vs-duration pacing, missing attendees). Template-data-driven, no LLM
- [x] Meeting prep follows into the room — the selected template's checklist/agenda is available during the meeting itself via a collapsible floating `MeetingPrepWindow`, not just at scheduling time
- [ ] Smart Meeting Preparation (AI phase) — history-aware suggestions, auto-attach relevant files, generated briefings/questions, persisted & shareable personal + organisation templates (needs backend + model + stored history)
- [x] Electron desktop app — native file open, window capture without OS dialog, drag-to-present with preview confirmation
- [ ] Self-hosted LiveKit option (Africa-first / data sovereignty)
