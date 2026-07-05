import { useMemo, useState } from 'react'
import {
  Building2, Handshake, RefreshCw, Lightbulb, Rocket, Users, TrendingUp,
  GraduationCap, Briefcase, Scale, Wrench, UserCheck, ClipboardCheck,
  CalendarDays, CheckCircle2, RotateCcw, DollarSign, Monitor, Search,
  BarChart3, Map as MapIcon, ArrowLeft, ChevronRight, type LucideIcon,
} from 'lucide-react'
import { MEETING_TEMPLATES, getTemplate } from './meetingTemplates'

// Simple, monochrome lucide icons — consistent with the rest of the app's icon
// language, in place of the earlier colourful emoji set.
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  board: Building2, client: Handshake, followup: RefreshCw, brainstorm: Lightbulb,
  kickoff: Rocket, standup: Users, sales: TrendingUp, training: GraduationCap,
  interview: Briefcase, executive: Scale, workshop: Wrench, 'one-on-one': UserCheck,
  performance: ClipboardCheck, 'sprint-planning': CalendarDays, 'sprint-review': CheckCircle2,
  retro: RotateCcw, investor: DollarSign, demo: Monitor, discovery: Search,
  quarterly: BarChart3, 'annual-planning': MapIcon,
}

// ============================================================
// SMART MEETING PREPARATION
// ============================================================
// v1 of the Meeting Preparation experience: pick a meeting-type card, then get a
// template-driven agenda, checklist, questions, goals, attendees and risks — all
// editable — plus a live readiness score, prep-time estimate, and rule-based
// smart recommendations (agenda-vs-duration pacing, missing attendees, etc.).
//
// Scope note: the deeper "AI" behaviours in the PRD (history-aware suggestions
// like "your third meeting with this client", auto-attaching relevant files,
// generated briefings, org/personal template persistence & sharing) require a
// backend + language model + stored history that this v1 doesn't wire up. The
// recommendations here are genuine deterministic logic, not a mocked model.

interface ChecklistItem { id: string; label: string; checked: boolean }

export function MeetingPrep({
  durationMinutes,
  attendeeCount,
}: {
  durationMinutes: number
  attendeeCount: number
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agenda, setAgenda] = useState<string[]>([])
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [newItem, setNewItem] = useState('')
  // Lets the host bypass meeting-prep entirely and go straight to creating
  // the meeting. Collapses the card grid; "Show options" brings it back.
  const [skipped, setSkipped] = useState(false)

  const template = selectedId ? getTemplate(selectedId) : undefined

  const selectTemplate = (id: string) => {
    const t = getTemplate(id)
    if (!t) return
    setSelectedId(id)
    setAgenda([...t.agenda])
    // "AI thinks you'll probably need" — start every suggested document checked
    // so the user un-checks what they don't need rather than checking everything.
    setChecklist(t.documents.map((label, i) => ({ id: `${id}-${i}`, label, checked: true })))
  }

  // Back to the full card grid — clears the panel state too, so returning to
  // this same card later starts fresh rather than flashing stale data.
  const backToOptions = () => {
    setSelectedId(null)
    setAgenda([])
    setChecklist([])
  }

  // ---- Live readiness + prep-time (recomputed on every edit) ----
  const { readiness, prepMinutes, missing, recommendations } = useMemo(() => {
    if (!template) return { readiness: 0, prepMinutes: 0, missing: [] as string[], recommendations: [] as string[] }

    const total = checklist.length || 1
    const checked = checklist.filter(c => c.checked).length
    const unchecked = checklist.filter(c => !c.checked)

    // Weighted readiness: documents ready (60%), attendees invited (20%), duration set (20%).
    const docScore = checked / total
    const attendeeScore = attendeeCount > 0 ? 1 : 0
    const durationScore = durationMinutes > 0 ? 1 : 0
    const readiness = Math.round((docScore * 0.6 + attendeeScore * 0.2 + durationScore * 0.2) * 100)

    // Prep estimate: ~4 min per outstanding document + fixed costs for gaps.
    const prepMinutes = unchecked.length * 4 + (attendeeCount === 0 ? 5 : 0) + (durationMinutes === 0 ? 2 : 0)

    const missing: string[] = []
    unchecked.slice(0, 4).forEach(c => missing.push(`Prepare: ${c.label}`))
    if (attendeeCount === 0) missing.push('Invite attendees')
    if (durationMinutes === 0) missing.push('Set a duration')

    // Rule-based smart recommendations (real logic — no model involved).
    const recommendations: string[] = []
    if (durationMinutes > 0 && agenda.length > 0) {
      const perTopic = durationMinutes / agenda.length
      if (perTopic < 2.5) {
        recommendations.push(`Your agenda has ${agenda.length} topics for a ${durationMinutes}-minute meeting (~${perTopic.toFixed(1)} min each). Consider increasing the duration or trimming the agenda.`)
      }
    }
    if (durationMinutes > 0 && durationMinutes < template.prepMinutes / 2 && agenda.length >= 6) {
      recommendations.push(`A ${template.title.toLowerCase()} with this much on the agenda usually needs more time than ${durationMinutes} minutes.`)
    }
    if (attendeeCount === 0) recommendations.push('Add attendees so suggestions can be tailored to who is in the room.')
    if (unchecked.length > 0) recommendations.push(`${unchecked.length} suggested document${unchecked.length > 1 ? 's are' : ' is'} not ready yet — check them off as you prepare.`)

    return { readiness, prepMinutes, missing, recommendations }
  }, [template, checklist, agenda, attendeeCount, durationMinutes])

  const scoreColor = readiness >= 75 ? '#48bb78' : readiness >= 45 ? '#f5c518' : '#e57373'

  return (
    <div style={st.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={st.sectionLabel}>Prepare for this meeting</div>
        {/* Bypass meeting-prep entirely — only offered before a card is
            picked; once skipped, "Show options" (below) is the way back. */}
        {!selectedId && !skipped && (
          <button type="button" style={st.skipBtn} onClick={() => setSkipped(true)}>
            Skip options <ChevronRight size={13} />
          </button>
        )}
      </div>

      {skipped ? (
        <button type="button" style={st.backBtn} onClick={() => setSkipped(false)}>
          Show meeting prep options
        </button>
      ) : (
        <>
          {/* ---- Meeting-type cards ---- */}
          {/* Once a card is picked, the rest collapse away and the selected one
              spans the full grid width (merging into the neighbouring slot)
              rather than leaving half the row empty — a "Back" button takes the
              host back to the full set of options. The grid container itself
              never resizes either way, so the panel below never shifts width. */}
          {selectedId && (
            <button type="button" style={st.backBtn} onClick={backToOptions}>
              <ArrowLeft size={13} /> Back to meeting types
            </button>
          )}
          <div style={st.cardGrid} aria-label="Meeting type">
            {(selectedId ? MEETING_TEMPLATES.filter(t => t.id === selectedId) : MEETING_TEMPLATES).map(t => {
              const active = t.id === selectedId
              const Icon = TEMPLATE_ICONS[t.id]
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${t.title} — ${t.description}`}
                  onClick={() => selectTemplate(t.id)}
                  className="bhv-prep-card"
                  style={{ ...st.card, ...(active ? { ...st.cardActive, gridColumn: '1 / -1' } : {}) }}
                >
                  {Icon && <Icon size={17} color={active ? '#f5a623' : '#888'} style={{ flexShrink: 0 }} />}
                  <span style={st.cardTitle}>{t.title}</span>
                  <span style={st.cardDesc}>{t.description}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {template && (
        <div style={st.panel}>
          {/* ---- Readiness dashboard ---- */}
          <div style={st.dash}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={st.dashTitle}>Meeting readiness</span>
              <span style={{ color: scoreColor, fontSize: 15, fontWeight: 700 }}>{readiness}%</span>
            </div>
            <div style={st.barTrack}>
              <div style={{ ...st.barFill, width: `${readiness}%`, background: scoreColor }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
              {missing.length > 0 && (
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={st.microLabel}>Missing</div>
                  {missing.map((m, i) => <div key={i} style={st.missingItem}>• {m}</div>)}
                </div>
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={st.microLabel}>Est. prep time</div>
                <div style={{ color: '#eee', fontSize: 18, fontWeight: 600 }}>{prepMinutes} min</div>
              </div>
            </div>
          </div>

          {/* ---- Objectives ---- */}
          <Section title="Objectives">
            {template.goals.map((g, i) => <div key={i} style={st.bullet}>◆ {g}</div>)}
          </Section>

          {/* ---- Agenda (editable) ---- */}
          <Section title={`Suggested agenda (${agenda.length})`}>
            {agenda.map((item, i) => (
              <div key={i} style={st.agendaRow}>
                <span style={st.agendaNum}>{i + 1}</span>
                <input
                  style={st.agendaInput}
                  value={item}
                  onChange={e => setAgenda(a => a.map((x, xi) => xi === i ? e.target.value : x))}
                  aria-label={`Agenda item ${i + 1}`}
                />
                <button type="button" onClick={() => setAgenda(a => a.filter((_, xi) => xi !== i))} style={st.rowRemove} aria-label="Remove agenda item">×</button>
              </div>
            ))}
            <button type="button" style={st.addBtn} onClick={() => setAgenda(a => [...a, ''])}>+ Add agenda item</button>
          </Section>

          {/* ---- Preparation checklist (interactive) ---- */}
          <Section title="AI thinks you'll probably need">
            {checklist.map(item => (
              <label key={item.id} style={st.checkRow}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => setChecklist(cs => cs.map(c => c.id === item.id ? { ...c, checked: !c.checked } : c))}
                  style={st.checkbox}
                />
                <span style={{ ...st.checkLabel, ...(item.checked ? { color: '#ddd' } : { color: '#777' }) }}>{item.label}</span>
                <button type="button" onClick={() => setChecklist(cs => cs.filter(c => c.id !== item.id))} style={st.rowRemove} aria-label={`Remove ${item.label}`}>×</button>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                style={st.addInput}
                placeholder="Add custom item…"
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newItem.trim()) {
                    e.preventDefault()
                    setChecklist(cs => [...cs, { id: `custom-${Date.now()}`, label: newItem.trim(), checked: false }])
                    setNewItem('')
                  }
                }}
              />
              <button
                type="button"
                style={st.addBtnSm}
                onClick={() => {
                  if (!newItem.trim()) return
                  setChecklist(cs => [...cs, { id: `custom-${Date.now()}`, label: newItem.trim(), checked: false }])
                  setNewItem('')
                }}
              >Add</button>
            </div>
          </Section>

          {/* ---- Suggested questions ---- */}
          <Section title="Suggested questions">
            {template.questions.map((q, i) => <div key={i} style={st.bullet}>— {q}</div>)}
          </Section>

          {/* ---- Suggested attendees ---- */}
          <Section title="Suggested attendees">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {template.attendees.map((a, i) => <span key={i} style={st.chip}>{a}</span>)}
            </div>
          </Section>

          {/* ---- Risks ---- */}
          <Section title="Risks to watch">
            {template.risks.map((r, i) => <div key={i} style={{ ...st.bullet, color: '#e0a0a0' }}>⚠ {r}</div>)}
          </Section>

          {/* ---- Smart recommendations ---- */}
          {recommendations.length > 0 && (
            <Section title="Recommendations">
              {recommendations.map((r, i) => (
                <div key={i} style={st.recCard}>{r}</div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={st.section}>
      <div style={st.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10, fontFamily: "'Roboto', sans-serif" },
  sectionLabel: { color: '#888', fontSize: 11, fontWeight: 300, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4 },
  backBtn: { display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', background: 'none', border: 'none', color: '#888', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', padding: '2px 0' },
  skipBtn: { display: 'flex', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: '#f5a623', fontSize: 12, fontWeight: 500, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', padding: '2px 0', letterSpacing: 0.3 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8, maxHeight: 264, overflowY: 'auto', paddingRight: 2 },
  card: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', transition: 'transform 0.12s ease, border-color 0.15s, background 0.15s', color: '#ddd', WebkitAppRegion: 'no-drag' as any },
  cardActive: { borderColor: '#f5a623', background: '#2a2010' },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#eee' },
  cardDesc: { fontSize: 11, fontWeight: 300, color: '#888' },
  panel: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 },
  dash: { background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, padding: 12 },
  dashTitle: { color: '#ccc', fontSize: 12, fontWeight: 500, letterSpacing: 0.5 },
  barTrack: { height: 8, borderRadius: 4, background: '#252525', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.35s ease, background 0.35s ease' },
  microLabel: { color: '#666', fontSize: 10, fontWeight: 300, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 },
  missingItem: { color: '#c98', fontSize: 11, fontWeight: 300, lineHeight: 1.5 },
  section: { display: 'flex', flexDirection: 'column', gap: 5 },
  sectionTitle: { color: '#aaa', fontSize: 12, fontWeight: 600, letterSpacing: 0.3 },
  bullet: { color: '#bbb', fontSize: 12, fontWeight: 300, lineHeight: 1.55 },
  agendaRow: { display: 'flex', alignItems: 'center', gap: 6 },
  agendaNum: { color: '#666', fontSize: 11, width: 16, flexShrink: 0, textAlign: 'center' },
  agendaInput: { flex: 1, background: '#181818', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ddd', fontSize: 12, padding: '6px 8px', outline: 'none', fontFamily: "'Roboto', sans-serif" },
  rowRemove: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px', flexShrink: 0 },
  addBtn: { alignSelf: 'flex-start', background: 'none', border: '1px dashed #333', borderRadius: 6, color: '#888', fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" },
  addBtnSm: { background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, padding: '0 12px', cursor: 'pointer', flexShrink: 0, fontFamily: "'Roboto', sans-serif" },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '2px 0' },
  checkbox: { width: 15, height: 15, accentColor: '#f5a623', cursor: 'pointer', flexShrink: 0 },
  checkLabel: { flex: 1, fontSize: 12, fontWeight: 300 },
  addInput: { flex: 1, background: '#181818', border: '1px solid #2a2a2a', borderRadius: 6, color: '#ddd', fontSize: 12, padding: '6px 8px', outline: 'none', fontFamily: "'Roboto', sans-serif" },
  chip: { background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 16, padding: '4px 10px', fontSize: 11, color: '#bbb', fontWeight: 300 },
  recCard: { background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 8, padding: '8px 10px', color: '#e8c98a', fontSize: 12, fontWeight: 300, lineHeight: 1.5 },
}
