import { useEffect } from 'react'

// Minimal, self-dismissing confirmation banner — reused wherever a background
// action (like sending an invite) needs a lightweight "yes, that worked"
// signal without blocking the UI the way alert() would.
export function Toast({ message, onDone, durationMs = 3200, variant = 'success' }: {
  message: string
  onDone: () => void
  durationMs?: number
  // 'error' swaps the accent to red and the tick to a cross, for actions that
  // failed. Defaults to 'success' so every existing call site is unchanged.
  variant?: 'success' | 'error'
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs)
    return () => clearTimeout(t)
  }, [onDone, durationMs])

  const accent = variant === 'error' ? '#e05252' : '#f5a623'

  return (
    <div
      style={{
        // Top centre, below the header — the controls bar lives at the bottom
        // centre of the meeting view, and a bottom-anchored toast sat right on
        // top of it, hiding the mic/camera/share buttons for its duration.
        position: 'fixed', left: '50%', top: 72, transform: 'translateX(-50%)',
        background: '#1a1a1a', border: `1px solid ${accent}`, borderRadius: 10,
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 1000,
        fontFamily: "'Roboto', sans-serif", maxWidth: 360,
        animation: 'bhv-toast-in 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`@keyframes bhv-toast-in { from { opacity: 0; transform: translate(-50%, -8px) } to { opacity: 1; transform: translate(-50%, 0) } }`}</style>
      <span style={{ color: accent, fontSize: 16, lineHeight: 1 }}>{variant === 'error' ? '✕' : '✓'}</span>
      <span style={{ color: '#eee', fontSize: 13, fontWeight: 300 }}>{message}</span>
    </div>
  )
}
