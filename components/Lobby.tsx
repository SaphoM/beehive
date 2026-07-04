import { useState, useEffect } from 'react'
import { User } from '@supabase/supabase-js'
import { s } from './roomStyles'
import { SUBTEXTS, STING_RED, REQUEST_ACCESS_EMAIL, REQUEST_ACCESS_MAILTO, type Subtext } from './roomUtils'
import { SchedulePanel } from './SchedulePanel'
import { FathomPanel } from './FathomPanel'
import { useAuth, useProfile } from '../livekit_react_hooks'
import { LogOut } from 'lucide-react'
import { OpenDesktopAppButton } from './DesktopHandoff'

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
          <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 999, background: 'rgba(245,197,24,0.12)', border: '1px solid rgba(245,197,24,0.4)', color: '#f5c518', fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, verticalAlign: 'middle' }}>Beta</span>
        </h2>
        <p style={{ color: '#666', fontSize: 12, lineHeight: 1.5 }}>
          Save your name and access meeting history across sessions.
        </p>
      </div>

      <p style={noteStyle}>
        BeeHive is in private <strong style={{ color: '#f5c518' }}>Beta</strong>. Accounts are
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
  displayName, onDisplayNameChange, onCreateRoom, onJoinRoom, creating, hasInvite, inviteRoom, subtext, onSubtextChange,
  user, showRegister, onDismissRegister,
}: {
  displayName: string
  onDisplayNameChange: (v: string) => void
  onCreateRoom: () => void
  onJoinRoom?: () => void
  creating: boolean
  hasInvite: boolean
  inviteRoom?: { name: string; participantCount: number; ended_at: string | null } | null
  subtext: Subtext
  onSubtextChange: (v: Subtext) => void
  user?: User | null
  showRegister?: boolean
  onDismissRegister?: () => void
}) {
  const { signOut } = useAuth()
  const { profile } = useProfile(user?.id ?? null)
  const [showFathom, setShowFathom] = useState(false)
  const [lobbyTab, setLobbyTab] = useState<'now' | 'schedule'>('now')
  const [flipped, setFlipped] = useState(false)

  useEffect(() => { if (showRegister) setFlipped(true) }, [showRegister])

  function handleDismissRegister() {
    setFlipped(false)
    setTimeout(() => onDismissRegister?.(), 520)
  }

  return (
    <div style={{ ...s.lobby, flexDirection: 'column', gap: 16 }}>
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
                <span style={{ color: '#555', fontSize: 11 }}>
                  {profile?.full_name ?? user.email?.split('@')[0]}
                </span>
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

            {lobbyTab === 'now' ? (
              <>
                {inviteRoom?.ended_at ? (
                  <div style={s.invitePreview}>
                    <p style={s.inviteLabel}>This meeting has ended</p>
                    <p style={s.inviteRoomName}>{inviteRoom.name}</p>
                    <button style={s.primaryBtn} onClick={onCreateRoom} disabled={creating}>Start a new meeting</button>
                  </div>
                ) : hasInvite && inviteRoom ? (
                  <div style={s.invitePreview}>
                    <p style={s.inviteLabel}>You've been invited to</p>
                    <p style={s.inviteRoomName}>{inviteRoom.name}</p>
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

                    {hasInvite ? (
                      <>
                        <button style={s.primaryBtn} onClick={onJoinRoom} disabled={creating}>
                          {creating ? 'Joining…' : 'Join Meeting'}
                        </button>
                        <button style={s.secondaryBtn} onClick={onCreateRoom} disabled={creating}>
                          Start a new meeting instead
                        </button>
                      </>
                    ) : (
                      <button
                        style={{ ...s.primaryBtn, background: subtext === 'Sting' ? STING_RED : '#f5a623' }}
                        onClick={onCreateRoom}
                        disabled={creating}
                      >
                        {creating ? 'Starting…' : `Start ${subtext}`}
                      </button>
                    )}
                  </>
                )}

                {!user && !flipped && (
                  <button
                    style={{ ...s.secondaryBtn, marginTop: 2, fontSize: 12, color: '#f5c518', borderColor: 'rgba(245,197,24,0.25)' }}
                    onClick={() => setFlipped(true)}
                  >
                    Register to save your history
                  </button>
                )}
              </>
            ) : (
              <SchedulePanel displayName={displayName} onDisplayNameChange={onDisplayNameChange} isSting={subtext === 'Sting'} />
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

      {/* Web only — continue in the desktop app (renders nothing inside Electron) */}
      <OpenDesktopAppButton style={{ maxWidth: 320 }} />
    </div>
  )
}
