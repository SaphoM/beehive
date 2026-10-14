import { useState } from 'react'
import { X, Minus, ClipboardList, ChevronUp } from 'lucide-react'
import { saveMeetingPrep, type StoredMeetingPrep } from './roomUtils'

// Floating in-meeting panel showing the prep checklist/agenda picked back at
// scheduling time (SchedulePanel → MeetingPrep → saveMeetingPrep). Mirrors
// AutoCamWindow's positioning/close pattern, with its own collapse affordance
// (minimise to a small pill, click to re-expand) since this panel is meant to
// stay reachable through a whole meeting without permanently occupying space.
export function MeetingPrepWindow({ roomId, prep, onClose }: {
  roomId: string
  prep: StoredMeetingPrep
  onClose: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [checklist, setChecklist] = useState(prep.checklist)

  const toggleItem = (id: string) => {
    const next = checklist.map(c => c.id === id ? { ...c, checked: !c.checked } : c)
    setChecklist(next)
    saveMeetingPrep(roomId, { ...prep, checklist: next })
  }

  if (collapsed) {
    return (
      <button style={st.pill} onClick={() => setCollapsed(false)} title="Show meeting prep">
        <ClipboardList size={14} color="#f5a623" />
        <span style={st.pillTitle}>{prep.title}</span>
        <ChevronUp size={13} color="#888" />
      </button>
    )
  }

  return (
    <div style={st.window}>
      <div style={st.header}>
        <span style={st.title}>
          <ClipboardList size={13} color="#f5a623" /> &nbsp;{prep.title.toUpperCase()}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button style={st.iconBtn} onClick={() => setCollapsed(true)} title="Collapse"><Minus size={14} /></button>
          <button style={st.iconBtn} onClick={onClose} title="Close"><X size={14} /></button>
        </div>
      </div>

      <div style={st.body}>
        {prep.agenda.length > 0 && (
          <div style={st.section}>
            <div style={st.sectionLabel}>Agenda</div>
            {prep.agenda.map((item, i) => (
              <div key={i} style={st.agendaRow}>
                <span style={st.agendaNum}>{i + 1}</span>
                <span style={st.agendaText}>{item}</span>
              </div>
            ))}
          </div>
        )}

        {checklist.length > 0 && (
          <div style={st.section}>
            <div style={st.sectionLabel}>Checklist</div>
            {checklist.map(item => (
              <label key={item.id} style={st.checkRow}>
                <input type="checkbox" checked={item.checked} onChange={() => toggleItem(item.id)} style={st.checkbox} />
                <span style={{ ...st.checkLabel, ...(item.checked ? { color: '#ddd' } : { color: '#777' }) }}>{item.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const st: Record<string, React.CSSProperties> = {
  window: {
    position: 'absolute', top: 20, left: 20, width: 260, maxHeight: '70%',
    background: '#141414', border: '1px solid #3a2c10', borderRadius: 12,
    overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)', zIndex: 15,
    display: 'flex', flexDirection: 'column', fontFamily: "'Roboto', sans-serif",
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', background: '#1a1a1a', borderBottom: '1px solid #222', flexShrink: 0,
  },
  title: {
    display: 'flex', alignItems: 'center', color: '#eee', fontSize: 11,
    fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  iconBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2 },
  body: { padding: '10px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 5 },
  sectionLabel: { color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' },
  agendaRow: { display: 'flex', alignItems: 'flex-start', gap: 6 },
  agendaNum: { color: '#666', fontSize: 11, width: 14, flexShrink: 0 },
  agendaText: { color: '#bbb', fontSize: 12, fontWeight: 300, lineHeight: 1.4 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  checkbox: { width: 14, height: 14, accentColor: '#f5a623', cursor: 'pointer', flexShrink: 0 },
  checkLabel: { fontSize: 12, fontWeight: 300 },
  pill: {
    position: 'absolute', top: 20, left: 20, zIndex: 15,
    display: 'flex', alignItems: 'center', gap: 6,
    background: '#1a1a1a', border: '1px solid #3a2c10', borderRadius: 20,
    padding: '6px 12px', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    fontFamily: "'Roboto', sans-serif",
  },
  pillTitle: { color: '#ccc', fontSize: 12, fontWeight: 400, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
}
