import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'

// ============================================================
// TIME PICKER
// ============================================================
// Safari renders no dropdown at all for a native <input type="time"> — only
// Chromium (Chrome, and Electron's desktop app) shows the two-column hour /
// minute dropdown. Rather than have Safari users get a degraded experience,
// this reimplements that same two-column dropdown as a plain button + panel
// so every browser — Safari, Firefox, Chrome, and the desktop app — looks
// and behaves identically.
//
// Value format matches the native input it replaces: 24-hour "HH:MM" string,
// '' when unset — so call sites didn't need to change at all.

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const pad = (n: number) => String(n).padStart(2, '0')

export function TimePicker({ value, onChange, style, selectedDate }: {
  value: string
  onChange: (v: string) => void
  style?: React.CSSProperties
  /** YYYY-MM-DD — when this matches today, past hours/minutes are disabled */
  selectedDate?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hourColRef = useRef<HTMLDivElement>(null)
  const minuteColRef = useRef<HTMLDivElement>(null)

  const [hh, mm] = value ? value.split(':').map(Number) : [null, null]

  // Determine which hours/minutes are in the past when date === today
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const isToday = selectedDate === todayStr
  const nowHour = now.getHours()
  const nowMinute = now.getMinutes()

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Scroll the current selection into view whenever the panel opens.
  useEffect(() => {
    if (!open) return
    hourColRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'center' })
    minuteColRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'center' })
  }, [open])

  // Picking an hour stays open so the user can continue to minutes.
  // Picking a minute closes — that's the natural end of selection.
  const pickHour = (h: number) => {
    const safeM = isToday && h === nowHour && (mm ?? 0) <= nowMinute
      ? (nowMinute + 1 < 60 ? nowMinute + 1 : nowMinute)
      : (mm ?? 0)
    onChange(`${pad(h)}:${pad(safeM)}`)
    // Scroll minutes column to first available after hour change
    setTimeout(() => {
      minuteColRef.current?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ block: 'center' })
    }, 0)
  }

  const pickMinute = (h: number, m: number) => {
    onChange(`${pad(h)}:${pad(m)}`)
    setOpen(false)
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          ...t.trigger,
          color: value ? '#fff' : '#666',
        }}
      >
        <span>{value || '--:--'}</span>
        <Clock size={15} color="#888" />
      </button>

      {open && (
        <div style={t.panel}>
          {/* Hour column — stays open after pick so user flows to minutes */}
          <div ref={hourColRef} style={t.col}>
            {HOURS.map(h => {
              const pastHour = isToday && h < nowHour
              return (
                <button
                  key={h}
                  type="button"
                  data-active={h === hh}
                  disabled={pastHour}
                  onClick={() => { if (!pastHour) pickHour(h) }}
                  style={{
                    ...t.cell,
                    ...(h === hh ? t.cellActive : {}),
                    ...(pastHour ? t.cellDisabled : {}),
                  }}
                >
                  {pad(h)}
                </button>
              )
            })}
          </div>
          {/* Minute column — closes on pick (selection is complete) */}
          <div ref={minuteColRef} style={t.col}>
            {MINUTES.map(m => {
              const pastMinute = isToday && (hh ?? 0) === nowHour && m <= nowMinute
              return (
                <button
                  key={m}
                  type="button"
                  data-active={m === mm}
                  disabled={pastMinute}
                  onClick={() => { if (!pastMinute) pickMinute(hh ?? 0, m) }}
                  style={{
                    ...t.cell,
                    ...(m === mm ? t.cellActive : {}),
                    ...(pastMinute ? t.cellDisabled : {}),
                  }}
                >
                  {pad(m)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const t: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    background: '#222', border: '1px solid #333', borderRadius: 10,
    padding: '11px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box',
    cursor: 'pointer', fontFamily: "'Roboto', sans-serif",
  },
  panel: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
    display: 'flex', gap: 1, background: '#1e1e1e', border: '1px solid #333',
    borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
  },
  col: {
    display: 'flex', flexDirection: 'column', width: 56, maxHeight: 168,
    overflowY: 'auto', padding: '4px 0',
  },
  cell: {
    background: 'none', border: 'none', color: '#ddd', fontSize: 13,
    fontFamily: "'Roboto', sans-serif", padding: '6px 0', cursor: 'pointer',
    textAlign: 'center',
  },
  cellActive: { background: '#2a2010', color: '#f5a623', fontWeight: 600 },
  cellDisabled: { color: '#333', cursor: 'not-allowed', pointerEvents: 'none' as const },
}
