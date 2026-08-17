import { useState, useEffect, useCallback } from 'react'
import { User } from '@supabase/supabase-js'
import { s } from './roomStyles'
import { SUBTEXTS, STING_RED, REQUEST_ACCESS_EMAIL, REQUEST_ACCESS_MAILTO, type Subtext } from './roomUtils'
import { SchedulePanel } from './SchedulePanel'
import { FathomPanel } from './FathomPanel'
import { MeetingNotesPanel } from './MeetingNotesPanel'
import { useAuth, useProfile, useMyMeetings, supabase } from '../livekit_react_hooks'
import { LogOut } from 'lucide-react'
import { EditableAvatar } from './Avatar'
import { OpenDesktopAppButton } from './DesktopHandoff'
import { BuiltByFooter } from './BuiltByFooter'
import { Toast } from './Toast'
import { MeetingCarousel, ConfirmSheet } from './MeetingCarousel'
import type { MyMeeting } from '../livekit_react_hooks'
import { useDeviceReadiness, isCriticalAudioIssue } from './useDeviceReadiness'
import { DeviceReadinessBanner } from './DeviceReadinessBanner'

interface NextMeeting { name: string; date: string; time: string; link: string }
const NEXT_MEETING_KEY = 'beehive:nextMeeting'

// -----------------------------------------------------------------------
// RegisterPanel — appears on card back face after a frictionless meeting.
// During the Beta, accounts are provisioned by X Spark, so this prompts the
// guest to request access rather than self-registering.
// -----------------------------------------------------------------------
function RegisterPanel({ onDismiss }: { onDismiss: () => void }) {
  const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }
  const noteStyle: React.CSSProperties = {
    color: '#999', fontSize: 12.5, lineHeight: 1.6, textAlign: 'center',
    background: 'rgba(245,197,24,0.05)', border: '1px solid rgba(245,197,24,0.18)',
    borderRadius: 8, padding: '12px 14px',
  }

  return (
    <div style={col}>
      <div>
        <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 400, marginBottom: 6 }}>
          Create your account
          <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 999, background: 'rgba(245,197,24,0.12)', border: '1px solid rgba(245,197,24,0.4)', color: '#f5a623', fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, verticalAlign: 'middle' }}>Beta</span>
        </h2>
        <p style={{ color: '#666', fontSize: 12, lineHeight: 1.5 }}>
          Save your name and access meeting history across sessions.
        </p>
      </div>

      <p style={noteStyle}>
        BeeHive is in private <strong style={{ color: '#f5a623' }}>Beta</strong>. Accounts are
        provisioned by X&nbsp;Spark — request access and we'll set you up.
      </p>

      <a
        href={REQUEST_ACCESS_MAILTO}
        style={{ ...s.primaryBtn, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
      >
        Request access from X Spark
      </a>
      <p style={{ color: '#555', fontSize: 11, textAlign: 'center', margin: 0 }}>{REQUEST_ACCESS_EMAIL}</p>

      <button style={s.secondaryBtn} type="button" onClick={onDismiss}>Not now</button>
    </div>
  )
}

// -----------------------------------------------------------------------
// Lobby
// -----------------------------------------------------------------------
export function Lobby({
  displayName, onDisplayNameChange, onCreateRoom, onJoinRoom, onStartScheduled, onJoinMeeting, creating, hasInvite, inviteRoom, subtext, onSubtextChange,
  user, showRegister, onDismissRegister,
}: {
  displayName: string
  onDisplayNameChange: (v: string) => void
  onCreateRoom: () => void
  onJoinRoom?: () => void
  // Enter the just-scheduled room (as host) directly — routes into the room
  // that holds the agenda, instead of the Start Now path that makes a fresh one.
  onStartScheduled?: (roomId: string) => void
  // Join a specific room from the carousel (invitee flow, goes through normal
  // waiting-room join path rather than the URL-param invite path).
  onJoinMeeting?: (roomId: string) => void
  creating: boolean
  hasInvite: boolean
  inviteRoom?: { name: string; participantCount: number; ended_at: string | null; scheduled_date: string | null; scheduled_time: string | null } | null
  subtext: Subtext
  onSubtextChange: (v: Subtext) => void
  user?: User | null
  showRegister?: boolean
  onDismissRegister?: () => void
}) {
  const { signOut } = useAuth()
  const { profile, updateProfile } = useProfile(user?.id ?? null)
  const displayNameForAvatar = profile?.full_name ?? user?.email?.split('@')[0] ?? ''
  const [showFathom, setShowFathom] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [lobbyTab, setLobbyTab] = useState<'now' | 'schedule'>('now')
  const [flipped, setFlipped] = useState(false)
  const [nextMeeting, setNextMeeting] = useState<NextMeeting | null>(() => {
    try {
      const raw = localStorage.getItem(NEXT_MEETING_KEY)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  // One toast channel for every lobby-level confirmation (scheduled, deleted,
  // and their failure cases) rather than a separate boolean per action.
  const [toast, setToast] = useState<{ message: string; variant?: 'success' | 'error' } | null>(null)
  // Stable so Toast's auto-dismiss timer isn't restarted by unrelated re-renders.
  const dismissToast = useCallback(() => setToast(null), [])

  // Session token needed by the carousel hook — fetched once and refreshed
  // whenever auth state changes. Only used when user is signed in.
  const [accessToken, setAccessToken] = useState<string | null>(null)
  useEffect(() => {
    if (!user) { setAccessToken(null); return }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setAccessToken(s?.access_token ?? null)
    })
    return () => subscription.unsubscribe()
  }, [user])

  const { meetings, loading: meetingsLoading, updateStatus, updateMeeting, refresh: refreshMeetings } = useMyMeetings(accessToken, user?.email)
  const deviceReadiness = useDeviceReadiness()
  const criticalAudio = isCriticalAudioIssue(deviceReadiness)

  // Which carousel card is currently selected — drives the primary button label
  const [selectedMeeting, setSelectedMeeting] = useState<MyMeeting | null>(null)
  // Which meeting is pending confirmation in the ConfirmSheet
  const [confirmMeeting, setConfirmMeeting] = useState<MyMeeting | null>(null)

  useEffect(() => { if (showRegister) setFlipped(true) }, [showRegister])

  function handleScheduled(meeting: NextMeeting) {
    setNextMeeting(meeting)
    try { localStorage.setItem(NEXT_MEETING_KEY, JSON.stringify(meeting)) } catch { /* storage unavailable — card just won't survive a refresh */ }
    setLobbyTab('now')
    setToast({ message: 'Meeting set up successfully' })
  }

  function dismissNextMeeting() {
    setNextMeeting(null)
    try { localStorage.removeItem(NEXT_MEETING_KEY) } catch { /* best-effort */ }
  }

  function handleDismissRegister() {
    setFlipped(false)
    setTimeout(() => onDismissRegister?.(), 520)
  }

  async function handleDeleteMeeting(meeting: MyMeeting) {
    let hostSecret: string | null = null
    try { hostSecret = localStorage.getItem(`beehive:hostSecret:${meeting.roomId}`) } catch { /* storage unavailable */ }
    if (!hostSecret) {
      // Organizer-only UI, so this normally can't happen — but if the secret is
      // missing (cleared storage, different device) say so instead of silently
      // doing nothing, which read as "the button is broken".
      setToast({ message: 'Can only delete from the device that scheduled it', variant: 'error' })
      return
    }
    const apiBase = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
      ? 'http://localhost:3001' : ''
    try {
      const resp = await fetch(`${apiBase}/api/rooms/${meeting.roomId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostSecret }),
      })
      // Previously unchecked: a 403/500 left the card on screen with no
      // feedback at all, indistinguishable from a successful delete.
      if (!resp.ok) {
        setToast({ message: 'Could not delete meeting — please try again', variant: 'error' })
        return
      }
      if (selectedMeeting?.roomId === meeting.roomId) setSelectedMeeting(null)
      // The room row is gone, so its host secret is dead data — drop it.
      try { localStorage.removeItem(`beehive:hostSecret:${meeting.roomId}`) } catch { /* best-effort */ }
      // Re-fetch so the deleted card leaves the carousel immediately rather
      // than lingering until the next window focus.
      await refreshMeetings()
      setToast({ message: 'Meeting deleted' })
    } catch (e) {
      console.error('[lobby] delete meeting failed:', e)
      setToast({ message: 'Network error — meeting not deleted', variant: 'error' })
    }
  }

  // Same hostSecret-from-localStorage lookup as handleDeleteMeeting above —
  // organizer-only UI, so this should always find one; the sheet surfaces
  // the error itself (via its own err state) rather than a toast, since
  // it's already the thing the user is looking at.
  async function handleEditMeeting(
    meeting: MyMeeting,
    updates: { name: string; scheduledDate: string; scheduledTime: string; durationMinutes: number },
  ) {
    let hostSecret: string | null = null
    try { hostSecret = localStorage.getItem(`beehive:hostSecret:${meeting.roomId}`) } catch { /* storage unavailable */ }
    if (!hostSecret) return { error: 'Can only edit from the device that scheduled it' }
    const result = await updateMeeting(meeting.roomId, hostSecret, updates)
    if (!result.error) setToast({ message: 'Meeting updated' })
    return result
  }

  function handleConfirmLaunch() {
    if (!confirmMeeting) return
    const m = confirmMeeting
    setConfirmMeeting(null)
    if (m.role === 'organizer') {
      onStartScheduled?.(m.roomId)
    } else {
      onJoinMeeting?.(m.roomId)
    }
  }

  return (
    <div style={{ ...s.lobby, flexDirection: 'column', gap: 16 }}>
      {confirmMeeting && (
        <ConfirmSheet
          meeting={confirmMeeting}
          onConfirm={handleConfirmLaunch}
          onCancel={() => setConfirmMeeting(null)}
        />
      )}
      {/* Card-flip scene */}
      <div style={{ perspective: 900 }}>
        <div style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.52s cubic-bezier(0.4,0,0.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          position: 'relative',
        }}>
          {/* Front face */}
          <div style={{ ...s.lobbyCard, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' } as React.CSSProperties}>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <EditableAvatar
                    name={displayNameForAvatar}
                    avatarUrl={profile?.avatar_url}
                    userId={user.id}
                    size={22}
                    onUpdated={url => updateProfile({ avatar_url: url })}
                  />
                  <span style={{ color: '#555', fontSize: 11 }}>
                    {displayNameForAvatar}
                  </span>
                </div>
                <button
                  onClick={signOut}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                  title="Sign out"
                >
                  <LogOut size={11} />
                  Sign out
                </button>
              </div>
            )}

            <h1 style={{ ...s.title, ...(subtext === 'Sting' ? { color: STING_RED } : {}) }}>
              <span style={{ fontWeight: 400 }}>BEE</span>HIVE
            </h1>

            {!hasInvite && (
              <div style={s.lobbyTabRow}>
                <button
                  style={{ ...s.lobbyTab, ...(lobbyTab === 'now' ? { ...s.lobbyTabActive, ...(subtext === 'Sting' ? { color: STING_RED } : {}) } : {}) }}
                  onClick={() => setLobbyTab('now')}
                >
                  Start Now
                </button>
                <button
                  style={{ ...s.lobbyTab, ...(lobbyTab === 'schedule' ? { ...s.lobbyTabActive, ...(subtext === 'Sting' ? { color: STING_RED } : {}) } : {}) }}
                  onClick={() => setLobbyTab('schedule')}
                >
                  Schedule
                </button>
              </div>
            )}

            {/* Carousel — signed-in users see their DB-backed meetings.
                Anonymous users fall back to the localStorage card below. */}
            {lobbyTab === 'now' && !hasInvite && user && meetings.length > 0 && (
              <MeetingCarousel
                meetings={meetings}
                loading={meetingsLoading}
                selectedMeetingId={selectedMeeting?.roomId ?? null}
                onSelect={setSelectedMeeting}
                onLaunch={m => setConfirmMeeting(m)}
                onDelete={handleDeleteMeeting}
                onEdit={handleEditMeeting}
                onUpdateStatus={updateStatus}
              />
            )}
            {lobbyTab === 'now' && !hasInvite && !user && nextMeeting && (
              <div style={{ ...s.invitePreview, position: 'relative' }}>
                <button
                  onClick={dismissNextMeeting}
                  style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
                  title="Dismiss"
                >×</button>
                <p style={s.inviteLabel}>Next meeting</p>
                <p style={s.inviteRoomName}>{nextMeeting.name}</p>
                {nextMeeting.date && (
                  <p style={s.inviteMeta}>
                    {new Date(`${nextMeeting.date}T${nextMeeting.time || '00:00'}`).toLocaleString(undefined, {
                      weekday: 'long', month: 'long', day: 'numeric',
                      ...(nextMeeting.time ? { hour: '2-digit', minute: '2-digit' } : {}),
                    })}
                  </p>
                )}
              </div>
            )}

            {lobbyTab === 'now' ? (
              <>
                {inviteRoom?.ended_at ? (
                  <div style={s.invitePreview}>
                    <p style={s.inviteLabel}>This meeting has ended</p>
                    <p style={s.inviteRoomName}>{inviteRoom.name}</p>
                    <button style={{ ...s.primaryBtn, ...(subtext === 'Sting' ? { background: STING_RED } : {}) }} onClick={onCreateRoom} disabled={creating}>Start a new meeting</button>
                  </div>
                ) : hasInvite && inviteRoom ? (
                  <div style={s.invitePreview}>
                    <p style={s.inviteLabel}>You've been invited to</p>
                    <p style={s.inviteRoomName}>{inviteRoom.name}</p>
                    {inviteRoom.scheduled_date && (
                      <p style={{ ...s.inviteMeta, color: '#aaa', fontSize: 11 }}>
                        {new Date(`${inviteRoom.scheduled_date}T${inviteRoom.scheduled_time || '00:00'}`).toLocaleString(undefined, {
                          weekday: 'long', month: 'long', day: 'numeric',
                          ...(inviteRoom.scheduled_time ? { hour: '2-digit', minute: '2-digit' } : {}),
                        })}
                      </p>
                    )}
                    <p style={s.inviteMeta}>
                      {inviteRoom.participantCount > 0
                        ? `${inviteRoom.participantCount} participant${inviteRoom.participantCount !== 1 ? 's' : ''} in the room`
                        : 'Be the first to join'}
                    </p>
                  </div>
                ) : !hasInvite ? (
                  <div style={s.subtextRow}>
                    {SUBTEXTS.map(t => (
                      <button key={t} style={{ ...s.subtextBtn, ...(subtext === t ? s.subtextActive : {}) }} onClick={() => onSubtextChange(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                ) : null}

                {!inviteRoom?.ended_at && (
                  <>
                    <input
                      style={s.input}
                      placeholder="Your name"
                      value={displayName}
                      onChange={(e) => onDisplayNameChange(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (hasInvite ? onJoinRoom?.() : onCreateRoom())}
                      autoFocus
                    />

                    <DeviceReadinessBanner readiness={deviceReadiness} />

                    {hasInvite ? (
                      <>
                        <button style={{ ...s.primaryBtn, ...(subtext === 'Sting' ? { background: STING_RED } : {}), ...(criticalAudio ? { background: '#7a3a00' } : {}) }} onClick={onJoinRoom} disabled={creating}>
                          {creating ? 'Joining…' : criticalAudio ? 'Resolve Audio Issue' : 'Join Meeting'}
                        </button>
                        <button style={s.secondaryBtn} onClick={onCreateRoom} disabled={creating}>
                          Start a new meeting instead
                        </button>
                      </>
                    ) : (() => {
                      // Primary label adapts to whichever carousel card is selected
                      const baseLabel = creating
                        ? (selectedMeeting ? (selectedMeeting.role === 'organizer' ? 'Starting…' : 'Joining…') : 'Starting…')
                        : selectedMeeting
                          ? (selectedMeeting.role === 'organizer' ? 'Start Scheduled Meeting' : 'Join Scheduled Meeting')
                          : `Start ${subtext}`
                      const btnLabel = !creating && criticalAudio ? 'Resolve Audio Issue' : baseLabel

                      const btnClick = selectedMeeting
                        ? () => setConfirmMeeting(selectedMeeting)
                        : onCreateRoom

                      return (
                        <>
                          <button
                            style={{ ...s.primaryBtn, background: criticalAudio ? '#7a3a00' : subtext === 'Sting' ? STING_RED : '#f5a623' }}
                            onClick={btnClick}
                            disabled={creating}
                          >
                            {btnLabel}
                          </button>
                          {/* "Start a new meeting instead" only shown when a scheduled meeting is selected */}
                          {selectedMeeting && (
                            <button style={s.secondaryBtn} onClick={onCreateRoom} disabled={creating}>
                              Start a new meeting instead
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </>
                )}

                {!user && !flipped && (
                  <button
                    style={{
                      ...s.secondaryBtn, marginTop: 2, fontSize: 12,
                      color: subtext === 'Sting' ? STING_RED : '#f5a623',
                      borderColor: subtext === 'Sting' ? 'rgba(239,68,68,0.3)' : 'rgba(245,166,35,0.25)',
                    }}
                    onClick={() => setFlipped(true)}
                  >
                    Register to save your history
                  </button>
                )}
              </>
            ) : (
              <SchedulePanel displayName={displayName} onDisplayNameChange={onDisplayNameChange} isSting={subtext === 'Sting'} onScheduled={handleScheduled} onStartMeeting={onStartScheduled} />
            )}
          </div>

          {/* Back face — register */}
          <div style={{
            ...s.lobbyCard,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            position: 'absolute',
            top: 0, left: 0, width: '100%',
          } as React.CSSProperties}>
            <RegisterPanel onDismiss={handleDismissRegister} />
          </div>
        </div>
      </div>

      <button style={s.fathomToggleBtn} onClick={() => setShowFathom(v => !v)}>
        <span style={{ opacity: 0.5, fontSize: 11 }}>◆</span>
        Recent meetings
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{showFathom ? '▲' : '▼'}</span>
      </button>

      {showFathom && <FathomPanel />}

      <button style={s.fathomToggleBtn} onClick={() => setShowNotes(v => !v)}>
        <span style={{ opacity: 0.5, fontSize: 11 }}>◆</span>
        Meeting Notes
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{showNotes ? '▲' : '▼'}</span>
      </button>

      {showNotes && <MeetingNotesPanel accessToken={accessToken} />}

      {/* Web only — continue in the desktop app (renders nothing inside Electron) */}
      <OpenDesktopAppButton style={{ maxWidth: 320 }} />

      <BuiltByFooter />

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDone={dismissToast} />
      )}
    </div>
  )
}
