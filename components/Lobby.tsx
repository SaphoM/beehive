import { useState } from 'react'
import { s } from './roomStyles'
import { SUBTEXTS, type Subtext } from './roomUtils'
import { SchedulePanel } from './SchedulePanel'
import { FathomPanel } from './FathomPanel'

export function Lobby({
  displayName, onDisplayNameChange, onCreateRoom, onJoinRoom, creating, hasInvite, inviteRoom, subtext, onSubtextChange,
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
}) {
  const [showFathom, setShowFathom] = useState(false)
  const [lobbyTab, setLobbyTab] = useState<'now' | 'schedule'>('now')

  return (
    <div style={{ ...s.lobby, flexDirection: 'column', gap: 16 }}>
      <div style={s.lobbyCard}>
        <h1 style={s.title}>
          <span style={{ fontWeight: 400 }}>BEE</span>HIVE
        </h1>

        {!hasInvite && (
          <div style={s.lobbyTabRow}>
            <button
              style={{ ...s.lobbyTab, ...(lobbyTab === 'now' ? s.lobbyTabActive : {}) }}
              onClick={() => setLobbyTab('now')}
            >
              Start Now
            </button>
            <button
              style={{ ...s.lobbyTab, ...(lobbyTab === 'schedule' ? s.lobbyTabActive : {}) }}
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
                <button style={s.primaryBtn} onClick={onCreateRoom} disabled={creating}>
                  Start a new meeting
                </button>
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
                  <button
                    key={t}
                    style={{ ...s.subtextBtn, ...(subtext === t ? s.subtextActive : {}) }}
                    onClick={() => onSubtextChange(t)}
                  >
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
                  <button style={s.primaryBtn} onClick={onCreateRoom} disabled={creating}>
                    {creating ? 'Starting…' : `Start ${subtext}`}
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <SchedulePanel displayName={displayName} onDisplayNameChange={onDisplayNameChange} />
        )}
      </div>

      <button style={s.fathomToggleBtn} onClick={() => setShowFathom(v => !v)}>
        <span style={{ opacity: 0.5, fontSize: 11 }}>◆</span>
        Recent meetings
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{showFathom ? '▲' : '▼'}</span>
      </button>

      {showFathom && <FathomPanel />}
    </div>
  )
}
