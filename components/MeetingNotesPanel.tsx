import { useState } from 'react'
import { s } from './roomStyles'
import { useMeetingNotes, type MeetingNote } from '../livekit_react_hooks'
import { LiteMarkdown } from './liteMarkdown'

// Meeting Notes — the additive, post-meeting UI surface for the opt-in
// Meeting Intelligence pipeline (LiveKit Egress + transcription + LLM
// summary). Deliberately mirrors FathomPanel.tsx's structure and reuses its
// existing `s.fathom*` style objects rather than inventing new ones: same
// expandable-row convention, same visual language, zero new layout risk in
// Lobby.tsx. The two panels are otherwise unrelated — this one is sourced
// entirely from BeeHive's own DB via GET /api/me/meeting-notes, not Fathom's
// third-party API.

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Per-row status affordance — the "notes ready" signal the plan calls for.
// Rooms where the feature was never enabled are omitted entirely by the
// backend (see /api/me/meeting-notes), so every status here is meaningful.
function statusLabel(status: string): { text: string; color: string } {
  switch (status) {
    case 'complete': return { text: 'Notes ready', color: '#48bb78' }
    case 'skipped_no_provider': return { text: 'Recording only', color: '#888' }
    case 'failed': return { text: 'Processing failed', color: '#e05252' }
    case 'recording': return { text: 'Recording…', color: '#f5a623' }
    default: return { text: 'Processing…', color: '#f5a623' } // egress_done / transcribing / transcribed / summarizing
  }
}

function MeetingNoteRow({ note }: { note: MeetingNote }) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = !!note.summaryMarkdown || (note.actionItems?.length ?? 0) > 0
  const status = statusLabel(note.status)

  return (
    <div style={s.fathomRow}>
      <button style={s.fathomRowHeader} onClick={() => hasContent && setExpanded(v => !v)}>
        <div style={s.fathomRowMeta}>
          <span style={s.fathomRowDate}>{fmtDate(note.createdAt)}</span>
          <span style={{ ...s.fathomRowDuration, color: status.color }}>{status.text}</span>
        </div>
        <div style={s.fathomRowTitle}>{note.roomName}</div>
        {hasContent && (
          <span style={{ ...s.fathomChip, marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {expanded && hasContent && (
        <div style={s.fathomDetail}>
          {note.summaryMarkdown && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Summary</div>
              <div style={s.fathomSummaryText}>
                <LiteMarkdown markdown={note.summaryMarkdown} />
              </div>
            </div>
          )}

          {(note.actionItems?.length ?? 0) > 0 && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Action Items</div>
              {note.actionItems!.map((item, i) => (
                <div key={i} style={s.fathomActionItem}>
                  <span style={{ color: '#555', flexShrink: 0, fontSize: 13 }}>○</span>
                  <span style={{ color: '#ccc', flex: 1, fontSize: 13 }}>
                    {item.task}
                    {item.due_date && <span style={{ color: '#777' }}> — Due {item.due_date}</span>}
                  </span>
                  {item.owner && (
                    <span style={s.fathomAssignee}>→ {item.owner.split(' ')[0]}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MeetingNotesPanel({ accessToken }: { accessToken: string | null | undefined }) {
  const { notes, loading } = useMeetingNotes(accessToken)

  return (
    <div style={s.fathomPanel}>
      <div style={s.fathomHeader}>
        <span style={s.fathomHeaderTitle}>◆ MEETING NOTES</span>
      </div>

      {loading && notes.length === 0 && (
        <div style={s.fathomEmpty}>Loading…</div>
      )}

      {!loading && notes.length === 0 && (
        <div style={s.fathomEmpty}>
          No recorded meetings yet — enable recording &amp; AI notes when scheduling a meeting to see notes here.
        </div>
      )}

      {notes.length > 0 && (
        <div style={s.fathomList}>
          {notes.map(n => <MeetingNoteRow key={n.roomId} note={n} />)}
        </div>
      )}
    </div>
  )
}
