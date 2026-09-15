import { X, FlipHorizontal, Plus, Trash2 } from 'lucide-react'
import { s } from './roomStyles'
import { VIRTUAL_PRESETS } from './roomUtils'
import type { SavedBackground } from './useBackgrounds'

export function BackgroundMenu({
  effect, presetId, flip, blurLevel, onEffect, onPreset, onFlip, onBlur, onClose,
  backgrounds, selectedBackgroundId, backgroundsLoading, backgroundsError, onSelectBackground, onAddBackground, onRemoveBackground,
}: {
  effect: 'none' | 'blur' | 'image' | 'virtual'
  presetId: string
  flip: boolean
  blurLevel: number
  onEffect: (e: 'none' | 'blur' | 'image' | 'virtual') => void
  onPreset: (id: string) => void
  onFlip: () => void
  onBlur: (v: number) => void
  onClose: () => void
  // "My Backgrounds" library — a list, not a single slot (see useBackgrounds)
  backgrounds: SavedBackground[]
  selectedBackgroundId: string | null
  backgroundsLoading: boolean
  backgroundsError: string | null
  onSelectBackground: (id: string) => void
  onAddBackground: (file: File) => void
  onRemoveBackground: (id: string) => void
}) {
  const tabs = [
    { key: 'none',    label: 'None' },
    { key: 'blur',    label: 'Blur' },
    { key: 'image',   label: 'Image' },
    { key: 'virtual', label: 'Virtual' },
  ] as const

  return (
    <div style={s.bgMenu}>
      <div style={s.shareMenuHeader}>
        <span style={s.shareMenuTitle}>Background</span>
        <button style={s.shareMenuClose} onClick={onClose}><X size={14} /></button>
      </div>

      <div style={s.bgTabs}>
        {tabs.map(t => (
          <button
            key={t.key}
            style={{ ...s.bgTab, ...(effect === t.key ? s.bgTabActive : {}) }}
            onClick={() => onEffect(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {effect === 'blur' && (
        <div style={s.bgSection}>
          <p style={s.bgHint}>Blurs the background behind you.</p>
          <div style={s.bgRow}>
            <span style={s.bgLabel}>Intensity</span>
            <input
              type="range" min={2} max={20} value={blurLevel}
              onChange={e => onBlur(Number(e.target.value))}
              style={s.bgSlider}
            />
            <span style={{ ...s.bgLabel, minWidth: 20, textAlign: 'right' as const }}>{blurLevel}</span>
          </div>
          {/* Whole row toggles — the tiny On/Off pill alone was a hard
              target and read as "not clickable". The pill stops propagation
              so a direct pill click doesn't double-toggle back. */}
          <div style={{ ...s.bgRow, cursor: 'pointer' }} onClick={onFlip}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={e => { e.stopPropagation(); onFlip() }}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {effect === 'image' && (
        <div style={s.bgSection}>
          <span style={{ ...s.bgLabel, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#666' }}>My Backgrounds</span>
          {/* Same 4-up thumbnail grid as the Virtual presets, so switching
              between saved photos feels identical to switching presets. The
              trash sits on the selected tile only — one affordance, no
              accidental deletes while browsing. */}
          <div style={s.bgPresetGrid}>
            {backgrounds.map(b => {
              const active = b.id === selectedBackgroundId
              return (
                <div key={b.id} style={{ position: 'relative' }}>
                  <button
                    title={b.label}
                    style={{
                      ...s.bgPresetBtn, width: '100%',
                      backgroundImage: `url("${b.url}")`, backgroundSize: 'cover', backgroundPosition: 'center',
                      ...(active ? s.bgPresetActive : {}),
                    }}
                    onClick={() => onSelectBackground(b.id)}
                  >
                    <span style={s.bgPresetLabel}>{b.label}</span>
                  </button>
                  {active && (
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveBackground(b.id) }}
                      title={`Remove ${b.label}`}
                      style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#ddd', display: 'flex', alignItems: 'center', padding: 3 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )
            })}
            <label title="Add background" style={{ cursor: 'pointer' }}>
              <input
                type="file" accept="image/*"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onAddBackground(f); e.target.value = '' }}
              />
              <div style={{ ...s.bgPresetBtn, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, background: '#222', border: '1px dashed #444' }}>
                <Plus size={14} color="#aaa" />
                <span style={{ color: '#aaa', fontSize: 9, fontFamily: "'Roboto', sans-serif", fontWeight: 300 }}>Add</span>
              </div>
            </label>
          </div>
          {backgroundsError && (
            <p style={{ ...s.bgHint, color: '#e05252' }}>{backgroundsError}</p>
          )}
          {!backgroundsError && backgrounds.length === 0 && !backgroundsLoading && (
            <p style={s.bgHint}>Add a photo and it replaces the background behind you. Saved ones stay here for next time.</p>
          )}
          {!backgroundsError && backgrounds.length > 0 && !selectedBackgroundId && (
            <p style={s.bgHint}>Pick a background to apply it.</p>
          )}
          {/* Whole row toggles — the tiny On/Off pill alone was a hard
              target and read as "not clickable". The pill stops propagation
              so a direct pill click doesn't double-toggle back. */}
          <div style={{ ...s.bgRow, cursor: 'pointer' }} onClick={onFlip}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={e => { e.stopPropagation(); onFlip() }}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {effect === 'virtual' && (
        <div style={s.bgSection}>
          <div style={s.bgPresetGrid}>
            {VIRTUAL_PRESETS.map(p => (
              <button
                key={p.id}
                title={p.label}
                style={{
                  ...s.bgPresetBtn,
                  background: `linear-gradient(135deg, ${p.preview.join(', ')})`,
                  ...(presetId === p.id ? s.bgPresetActive : {}),
                }}
                onClick={() => onPreset(p.id)}
              >
                <span style={s.bgPresetLabel}>{p.label}</span>
              </button>
            ))}
          </div>
          {/* Whole row toggles — the tiny On/Off pill alone was a hard
              target and read as "not clickable". The pill stops propagation
              so a direct pill click doesn't double-toggle back. */}
          <div style={{ ...s.bgRow, cursor: 'pointer' }} onClick={onFlip}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={e => { e.stopPropagation(); onFlip() }}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
