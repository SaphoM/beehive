// ============================================================
// BEEHIVE BOT ASSISTANT — floating agenda assistant
// ============================================================
// A new, additive feature — deliberately separate from the existing
// scheduling-time "meeting prep" feature (SchedulePanel → MeetingPrep →
// MeetingPrepWindow, persisted in localStorage under `beehive:prep:<roomId>`).
// That feature is per-device and read-only once in the room, which was fine
// for its original purpose but wrong for a *live, shared* agenda every
// participant needs to see update in real time — including Start Now
// meetings, which never have scheduling-time prep at all. This talks to its
// own new `meeting_agendas` table (see supabase/migrations/006_meeting_
// agenda.sql) instead of touching that existing feature or its storage.
//
// EXTENSION POINTS for the "Future Ready" features explicitly listed as
// out-of-scope-for-now (AI summaries, live transcription, automatic
// minutes, task generation, calendar/Jira/Trello/M365/Workspace sync):
//   - `AgendaItem` already carries a stable `id`, so any future feature that
//     needs to reference "this specific agenda item" (a generated task, a
//     calendar sync target, a transcript timestamp) has something stable to
//     key off immediately, no schema change needed.
//   - The three AI-assist actions below (suggestStructure/generateObjectives/
//     estimateTime) are pure local heuristics — no LLM call exists in this
//     codebase yet. They're isolated in one place (search "AI-ASSIST
//     HEURISTICS" below) specifically so swapping any one of them for a real
//     model call later is a localized change, not a redesign.
//   - `meeting_agendas` is one row per room with room-scoped RLS already
//     matching every other realtime table here — a future `summary text` or
//     `transcript_url text` column is an additive migration, not a new table.
import { useState, useEffect, useRef } from 'react'
import { Bot, X, Minus, Sparkles, Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useMeetingAgenda, type MeetingAgenda, type AgendaItem } from '../livekit_react_hooks'

const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

const EMPTY_AGENDA: MeetingAgenda = { title: 'Meeting Agenda', organizer_name: null, objectives: [], items: [], updated_at: '' }

// ------------------------------------------------------------
// AI-ASSIST HEURISTICS — local, not a real model call. See the file-level
// comment above for why these are isolated here.
// ------------------------------------------------------------
function suggestStructure(): { objectives: string[]; items: string[] } {
  return {
    objectives: ['Align on priorities', 'Review progress', 'Agree next steps'],
    items: ['Welcome & introductions', 'Review previous action items', 'Main discussion', 'Decisions', 'Action items & close'],
  }
}
function generateObjectivesFrom(items: AgendaItem[]): string[] {
  if (items.length === 0) return []
  // Naive but genuinely derived from the actual agenda, not canned text:
  // turn each item's text into an objective-shaped phrase.
  return items.slice(0, 4).map(i => `Address: ${i.text}`)
}
function estimateMinutesPerItem(totalMinutes: number, itemCount: number): number {
  if (itemCount === 0) return 0
  return Math.max(1, Math.round(totalMinutes / itemCount))
}

export function BotAssistant({ roomId, displayName, canEdit, hostSecret }: {
  roomId: string
  displayName: string
  canEdit: boolean
  hostSecret: string | null
}) {
  const { agenda: liveAgenda } = useMeetingAgenda(roomId)
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [draft, setDraft] = useState<MeetingAgenda>(EMPTY_AGENDA)
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [newItemText, setNewItemText] = useState('')
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-sync the local draft from the live (realtime) agenda — but never
  // while a local edit is still debouncing, or a keystroke could get
  // overwritten by a fetch that started before it landed.
  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(liveAgenda ?? EMPTY_AGENDA)
  }, [liveAgenda])

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  function scheduleSave(next: MeetingAgenda) {
    setDraft(next)
    if (!canEdit) return
    dirtyRef.current = true
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/api/rooms/${roomId}/agenda`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: next.title,
            organizerName: next.organizer_name,
            objectives: next.objectives,
            items: next.items,
            actingDisplayName: displayName,
            hostSecret: hostSecret ?? undefined,
          }),
        })
      } catch (e) {
        console.error('[agenda] save failed:', e)
      } finally {
        dirtyRef.current = false
      }
    }, 600)
  }

  const setTitle = (title: string) => scheduleSave({ ...draft, title })
  const setObjectives = (objectives: string[]) => scheduleSave({ ...draft, objectives })
  const setItems = (items: AgendaItem[]) => scheduleSave({ ...draft, items })

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    const item: AgendaItem = { id: uid(), text, completed: false, notes: '', order: draft.items.length }
    setItems([...draft.items, item])
    setNewItemText('')
  }
  const removeItem = (id: string) => setItems(draft.items.filter(i => i.id !== id))
  const updateItem = (id: string, patch: Partial<AgendaItem>) => setItems(draft.items.map(i => i.id === id ? { ...i, ...patch } : i))
  const moveItem = (id: string, dir: -1 | 1) => {
    const idx = draft.items.findIndex(i => i.id === id)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= draft.items.length) return
    const next = [...draft.items]
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    setItems(next.map((i, order) => ({ ...i, order })))
  }
  const toggleNotes = (id: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const runSuggestStructure = () => {
    const { objectives, items } = suggestStructure()
    scheduleSave({
      ...draft,
      objectives: draft.objectives.length ? draft.objectives : objectives,
      items: draft.items.length ? draft.items : items.map((text, order) => ({ id: uid(), text, completed: false, notes: '', order })),
    })
  }
  const runGenerateObjectives = () => setObjectives(generateObjectivesFrom(draft.items))
  const runEstimateTime = () => {
    const totalStr = window.prompt('Total meeting length in minutes?', '30')
    const total = Number(totalStr)
    if (!total || total <= 0) return
    const perItem = estimateMinutesPerItem(total, draft.items.length)
    setItems(draft.items.map(i => ({ ...i, notes: i.notes || `~${perItem} min` })))
  }

  const completedCount = draft.items.filter(i => i.completed).length

  // Collapsed: only the floating circular button.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open BeeHive Assistant"
        title="BeeHive Assistant"
        style={st.fab}
      >
        <Bot size={22} color="#000" />
        {draft.items.length > 0 && (
          <span style={st.fabBadge}>{completedCount}/{draft.items.length}</span>
        )}
      </button>
    )
  }

  return (
    <div style={{ ...st.panel, transform: minimized ? 'translateX(calc(100% - 52px))' : 'translateX(0)' }} role="dialog" aria-label="BeeHive Assistant">
      <div style={st.header}>
        <div style={st.headerTitle}>
          <Bot size={16} color="#f5a623" />
          {!minimized && <span>BeeHive Assistant</span>}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {!minimized && (
            <button style={st.iconBtn} onClick={() => setMinimized(true)} title="Minimise" aria-label="Minimise"><Minus size={14} /></button>
          )}
          {minimized && (
            <button style={st.iconBtn} onClick={() => setMinimized(false)} title="Expand" aria-label="Expand"><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button>
          )}
          <button style={st.iconBtn} onClick={() => { setOpen(false); setMinimized(false) }} title="Close" aria-label="Close"><X size={14} /></button>
        </div>
      </div>

      {!minimized && (
        <div style={st.body}>
          <div style={st.section}>
            {canEdit ? (
              <input
                value={draft.title}
                onChange={e => setTitle(e.target.value)}
                style={st.titleInput}
                aria-label="Meeting title"
                placeholder="Meeting title"
              />
            ) : (
              <div style={st.titleText}>{draft.title}</div>
            )}
            {draft.organizer_name && <div style={st.meta}>Organizer: {draft.organizer_name}</div>}
          </div>

          {canEdit && (
            <div style={st.aiRow}>
              <button style={st.aiBtn} onClick={runSuggestStructure} title="Suggest an agenda structure">
                <Sparkles size={11} /> Suggest structure
              </button>
              <button style={st.aiBtn} onClick={runGenerateObjectives} title="Generate objectives from the current agenda" disabled={draft.items.length === 0}>
                <Sparkles size={11} /> Generate objectives
              </button>
              <button style={st.aiBtn} onClick={runEstimateTime} title="Estimate time per item" disabled={draft.items.length === 0}>
                <Sparkles size={11} /> Estimate time
              </button>
            </div>
          )}

          {draft.objectives.length > 0 && (
            <div style={st.section}>
              <div style={st.sectionLabel}>Objectives</div>
              {draft.objectives.map((obj, i) => (
                <div key={i} style={st.objectiveRow}>
                  <span style={st.bullet}>◆</span>
                  <span style={st.objectiveText}>{obj}</span>
                  {canEdit && (
                    <button style={st.smallIconBtn} onClick={() => setObjectives(draft.objectives.filter((_, j) => j !== i))} title="Remove" aria-label="Remove objective">
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={st.section}>
            <div style={st.sectionLabel}>
              Agenda {draft.items.length > 0 && <span style={st.count}>({completedCount}/{draft.items.length})</span>}
            </div>

            {draft.items.length === 0 && (
              <p style={st.empty}>{canEdit ? 'No agenda yet — add an item below, or ask the assistant to suggest a structure.' : 'No agenda has been set for this meeting.'}</p>
            )}

            {draft.items.map(item => (
              <div key={item.id} style={st.itemCard}>
                <div style={st.itemRow}>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => updateItem(item.id, { completed: !item.completed })}
                    disabled={!canEdit}
                    style={st.checkbox}
                    aria-label={`Mark "${item.text}" ${item.completed ? 'incomplete' : 'complete'}`}
                  />
                  {canEdit ? (
                    <input
                      value={item.text}
                      onChange={e => updateItem(item.id, { text: e.target.value })}
                      style={{ ...st.itemInput, ...(item.completed ? { color: '#666', textDecoration: 'line-through' } : {}) }}
                      aria-label="Agenda item"
                    />
                  ) : (
                    <span style={{ ...st.itemText, ...(item.completed ? { color: '#666', textDecoration: 'line-through' } : {}) }}>{item.text}</span>
                  )}
                  <button style={st.smallIconBtn} onClick={() => toggleNotes(item.id)} title="Notes" aria-label="Toggle notes">
                    {expandedNotes.has(item.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {canEdit && (
                    <>
                      <button style={st.smallIconBtn} onClick={() => moveItem(item.id, -1)} title="Move up" aria-label="Move up"><GripVertical size={12} /></button>
                      <button style={st.smallIconBtn} onClick={() => removeItem(item.id)} title="Delete" aria-label="Delete item"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
                {expandedNotes.has(item.id) && (
                  canEdit ? (
                    <textarea
                      value={item.notes}
                      onChange={e => updateItem(item.id, { notes: e.target.value })}
                      placeholder="Notes…"
                      style={st.notesInput}
                      aria-label="Item notes"
                    />
                  ) : (
                    <p style={st.notesText}>{item.notes || 'No notes.'}</p>
                  )
                )}
              </div>
            ))}

            {canEdit && (
              <div style={st.addRow}>
                <input
                  value={newItemText}
                  onChange={e => setNewItemText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addItem()}
                  placeholder="Add agenda item…"
                  style={st.addInput}
                  aria-label="New agenda item"
                />
                <button style={st.addBtn} onClick={addItem} title="Add item" aria-label="Add item"><Plus size={14} /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const st: Record<string, React.CSSProperties> = {
  // Bottom-right, clear of the centred bottom control bar and of
  // SpeakingIndicator's secondary (presentation-mode) window, which anchors
  // bottom:20/right:20 only when two people are speaking during a
  // presentation — a rare overlap, and this sits above it regardless.
  fab: {
    position: 'absolute', bottom: 90, right: 24, zIndex: 40,
    width: 52, height: 52, borderRadius: '50%', background: '#f5a623',
    border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  fabBadge: {
    position: 'absolute', bottom: -4, right: -4, background: '#1a1a1a', border: '2px solid #0a0a0a',
    borderRadius: 10, color: '#f5a623', fontSize: 9, fontWeight: 700, padding: '1px 5px',
    fontFamily: "'Roboto', sans-serif",
  },
  panel: {
    position: 'absolute', top: 60, bottom: 90, right: 24, zIndex: 40, width: 320,
    background: '#141414', border: '1px solid #3a2c10', borderRadius: 14,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden', fontFamily: "'Roboto', sans-serif",
    transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
  },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 6, color: '#eee', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' as const, overflow: 'hidden' },
  iconBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 },
  smallIconBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0 },
  body: { padding: '12px', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 14, flex: 1 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  sectionLabel: { color: '#888', fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: 6 },
  count: { color: '#f5a623', fontWeight: 400, textTransform: 'none' as const, letterSpacing: 0 },
  titleInput: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 500, padding: '7px 10px', fontFamily: "'Roboto', sans-serif" },
  titleText: { color: '#fff', fontSize: 14, fontWeight: 500 },
  meta: { color: '#666', fontSize: 11 },
  aiRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  aiBtn: {
    display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)',
    borderRadius: 20, color: '#f5a623', fontSize: 10.5, fontFamily: "'Roboto', sans-serif", padding: '5px 10px', cursor: 'pointer',
  },
  objectiveRow: { display: 'flex', alignItems: 'flex-start', gap: 6 },
  bullet: { color: '#f5a623', fontSize: 9, marginTop: 2, flexShrink: 0 },
  objectiveText: { color: '#ccc', fontSize: 12, fontWeight: 300, lineHeight: 1.4, flex: 1 },
  empty: { color: '#666', fontSize: 12, fontWeight: 300, lineHeight: 1.5, margin: 0 },
  itemCard: { background: '#1a1a1a', border: '1px solid #262626', borderRadius: 8, padding: '7px 8px', display: 'flex', flexDirection: 'column' as const, gap: 6 },
  itemRow: { display: 'flex', alignItems: 'center', gap: 6 },
  checkbox: { width: 14, height: 14, accentColor: '#f5a623', cursor: 'pointer', flexShrink: 0 },
  itemInput: { flex: 1, minWidth: 0, background: 'none', border: 'none', color: '#ddd', fontSize: 12, fontFamily: "'Roboto', sans-serif", padding: '2px 0' },
  itemText: { flex: 1, minWidth: 0, color: '#ddd', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  notesInput: { background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ccc', fontSize: 11, fontFamily: "'Roboto', sans-serif", padding: '6px 8px', resize: 'vertical' as const, minHeight: 40 },
  notesText: { color: '#999', fontSize: 11, fontWeight: 300, margin: 0, lineHeight: 1.4 },
  addRow: { display: 'flex', gap: 6, marginTop: 2 },
  addInput: { flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#ddd', fontSize: 12, fontFamily: "'Roboto', sans-serif", padding: '7px 10px' },
  addBtn: { background: '#f5a623', border: 'none', borderRadius: 8, color: '#000', width: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
}
