import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const MAX_LEN = 50
const FONT = "'Roboto', sans-serif"

interface Anchor { x: number; y: number; width: number }

interface Props {
  emoji: string
  defaultText: string
  anchor: Anchor
  onSend: (emoji: string, message: string) => void
  onClose: () => void
  lastReactionAt: React.MutableRefObject<number>
  cooldownMs: number
}

export function ReactionComposer({ emoji, defaultText, anchor, onSend, onClose, lastReactionAt, cooldownMs }: Props) {
  const [text, setText] = useState(defaultText)
  const [cooldownLeft, setCooldownLeft] = useState(() =>
    Math.max(0, cooldownMs - (Date.now() - lastReactionAt.current))
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus + select all so the user can immediately retype
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  // Tick the cooldown counter every 250 ms
  useEffect(() => {
    if (cooldownLeft === 0) return
    const id = setInterval(() => {
      const remaining = Math.max(0, cooldownMs - (Date.now() - lastReactionAt.current))
      setCooldownLeft(remaining)
      if (remaining === 0) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [cooldownLeft, cooldownMs, lastReactionAt])

  const canSend = cooldownLeft === 0

  function handleSend() {
    if (!canSend) return
    onSend(emoji, text.trim())
    onClose()
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  // Position composer centred above the emoji button, clamped to viewport
  const W = 296
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, anchor.x + anchor.width / 2 - W / 2))
  const bottomPx = window.innerHeight - anchor.y + 12 // 12 px gap above button top

  const over = text.length > MAX_LEN * 0.86

  return (
    <>
      {/* click-away backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 300 }}
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-label={`Send ${emoji} reaction with message`}
        style={{
          position: 'fixed',
          left,
          bottom: bottomPx,
          width: W,
          zIndex: 301,
          background: 'rgba(18,18,18,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 16,
          padding: '14px 14px 12px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.04) inset',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animation: 'composerIn 0.17s cubic-bezier(0.34,1.56,0.64,1) both',
          fontFamily: FONT,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header row: emoji + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 26, lineHeight: 1, userSelect: 'none' }}>{emoji}</span>
          <button
            onClick={onClose}
            aria-label="Cancel"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6, marginLeft: 'auto' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Editable message */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={handleKey}
          placeholder="Say something…"
          maxLength={MAX_LEN}
          aria-label="Reaction message"
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${over ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 10,
            padding: '9px 11px',
            color: '#f0f0f0',
            fontSize: 13,
            fontFamily: FONT,
            fontWeight: 300,
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
        />

        {/* Counter + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11, color: over ? '#f5a623' : '#444', fontWeight: 300, flexShrink: 0 }}>
            {text.length} / {MAX_LEN}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 8, color: '#666', fontSize: 12, fontFamily: FONT, fontWeight: 300, padding: '5px 12px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label={canSend ? 'Send reaction' : `Wait ${Math.ceil(cooldownLeft / 1000)}s`}
              title={canSend ? undefined : `Cooldown — ${Math.ceil(cooldownLeft / 1000)}s`}
              style={{
                background: canSend ? '#f5c518' : '#222',
                border: 'none',
                borderRadius: 8,
                color: canSend ? '#000' : '#555',
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: 600,
                padding: '5px 14px',
                cursor: canSend ? 'pointer' : 'not-allowed',
                minWidth: 52,
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {canSend ? 'Send' : `${Math.ceil(cooldownLeft / 1000)}s`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
