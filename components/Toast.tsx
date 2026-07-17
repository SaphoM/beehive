import { useEffect } from 'react'

// Minimal, self-dismissing confirmation banner — reused wherever a background
// action (like sending an invite) needs a lightweight "yes, that worked"
// signal without blocking the UI the way alert() would.
export function Toast({ message, onDone, durationMs = 3200 }: {
  message: string
  onDone: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs)
    return () => clearTimeout(t)
  }, [onDone, durationMs])

  return (
    <div
      style={{
        // Top centre, below the header — the controls bar lives at the bottom
        // centre of the meeting view, and a bottom-anchored toast sat right on
        // top of it, hiding the mic/camera/share buttons for its duration.
        position: 'fixed', left: '50%', top: 72, transform: 'translateX(-50%)',
        background: '#1a1a1a', border: '1px solid #f5a623', borderRadius: 10,
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 1000,
        fontFamily: "'Roboto', sans-serif", maxWidth: 360,
        animation: 'bhv-toast-in 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <style>{`@keyframes bhv-toast-in { from { opacity: 0; transform: translate(-50%, -8px) } to { opacity: 1; transform: translate(-50%, 0) } }`}</style>
      <span style={{ color: '#f5a623', fontSize: 16, lineHeight: 1 }}>✓</span>
      <span style={{ color: '#eee', fontSize: 13, fontWeight: 300 }}>{message}</span>
    </div>
  )
}
