import { useState } from 'react'
import { s } from './roomStyles'
import { useFathomMeetings, useFathomTranscript, type FathomMeeting, type FathomTranscriptLine } from '../livekit_react_hooks'

function fmtDuration(start?: string, end?: string): string {
  if (!start || !end) return ''
  const min = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function getRecordingId(url: string): string | null {
  return url?.match(/recordings\/([a-zA-Z0-9_-]+)/)?.[1] ?? null
}

function FathomMeetingRow({ meeting }: { meeting: FathomMeeting }) {
  const [expanded, setExpanded] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const recordingId = getRecordingId(meeting.url)
  const { transcript, loading: tLoading, loadTranscript } = useFathomTranscript(recordingId)
  const title = meeting.title || meeting.meeting_title || 'Untitled meeting'
  const duration = fmtDuration(meeting.recording_start_time, meeting.recording_end_time)
  const attendeeCount = meeting.calendar_invitees?.length ?? 0
  const hasContent = !!(meeting.default_summary?.markdown_formatted || meeting.action_items?.length)

  const handleTranscript = () => {
    if (!showTranscript && !transcript) loadTranscript()
    setShowTranscript(v => !v)
  }

  return (
    <div style={s.fathomRow}>
      <button style={s.fathomRowHeader} onClick={() => hasContent && setExpanded(v => !v)}>
        <div style={s.fathomRowMeta}>
          <span style={s.fathomRowDate}>{fmtDate(meeting.created_at)}</span>
          {duration && <span style={s.fathomRowDuration}>{duration}</span>}
          {attendeeCount > 0 && <span style={s.fathomRowDuration}>{attendeeCount} people</span>}
        </div>
        <div style={s.fathomRowTitle}>{title}</div>
        {meeting.recorded_by && (
          <div style={s.fathomRowRecordedBy}>Recorded by {meeting.recorded_by.name}</div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          {meeting.share_url && (
            <a href={meeting.share_url} target="_blank" rel="noreferrer" style={s.fathomLink}
               onClick={e => e.stopPropagation()}>
              Open ↗
            </a>
          )}
          {hasContent && (
            <span style={{ ...s.fathomChip, marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div style={s.fathomDetail}>
          {meeting.default_summary?.markdown_formatted && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Summary</div>
              <div style={s.fathomSummaryText}>
                {meeting.default_summary.markdown_formatted}
              </div>
            </div>
          )}

          {(meeting.action_items?.length ?? 0) > 0 && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Action Items</div>
              {meeting.action_items!.map((item, i) => (
                <div key={i} style={s.fathomActionItem}>
                  <span style={{ color: item.completed ? '#48bb78' : '#555', flexShrink: 0, fontSize: 13 }}>
                    {item.completed ? '✓' : '○'}
                  </span>
                  <span style={{
                    color: item.completed ? '#555' : '#ccc',
                    textDecoration: item.completed ? 'line-through' : 'none',
                    flex: 1, fontSize: 13,
                  }}>
                    {item.description}
                  </span>
                  {item.assignee && (
                    <span style={s.fathomAssignee}>→ {item.assignee.name.split(' ')[0]}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {recordingId && (
            <button style={s.fathomTranscriptToggle} onClick={handleTranscript}>
              {tLoading ? 'Loading…' : showTranscript ? '▲ Hide transcript' : '▼ View transcript'}
            </button>
          )}

          {showTranscript && transcript && (
            <div style={s.fathomTranscript}>
              {transcript.map((line: FathomTranscriptLine, i: number) => (
                <div key={i} style={s.fathomTranscriptLine}>
                  <span style={s.fathomTranscriptTime}>{line.timestamp}</span>
                  <span style={s.fathomTranscriptSpeaker}>{line.speaker.display_name}</span>
                  <span style={s.fathomTranscriptText}>{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FathomPanel() {
  const { meetings, loading, error, hasMore, loadMore } = useFathomMeetings(8)

  const errorMsg = error
    ? (error.includes('not configured') || error.includes('503'))
      ? 'Add FATHOM_API_KEY to .env to connect.'
      : (error.includes('timed out') || error.includes('502'))
        ? 'Fathom is temporarily unavailable — try again shortly.'
        : `Could not load meetings: ${error}`
    : null

  return (
    <div style={s.fathomPanel}>
      <div style={s.fathomHeader}>
        <span style={s.fathomHeaderTitle}>◆ FATHOM</span>
        <a href="https://app.fathom.video" target="_blank" rel="noreferrer" style={s.fathomLink}>
          Open Fathom ↗
        </a>
      </div>

      {errorMsg && (
        <div style={{ ...s.fathomEmpty, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <span>{errorMsg}</span>
          <button style={s.fathomRetryBtn} onClick={loadMore}>Retry</button>
        </div>
      )}

      {!errorMsg && loading && meetings.length === 0 && (
        <div style={s.fathomEmpty}>Loading…</div>
      )}

      {!errorMsg && !loading && meetings.length === 0 && (
        <div style={s.fathomEmpty}>No Fathom meetings found.</div>
      )}

      {!errorMsg && (
        <div style={s.fathomList}>
          {meetings.map((m, i) => <FathomMeetingRow key={m.url ?? i} meeting={m} />)}
        </div>
      )}

      {hasMore && (
        <button style={s.fathomLoadMore} onClick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
