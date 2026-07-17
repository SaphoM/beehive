import { X, FlipHorizontal, Upload, Trash2 } from 'lucide-react'
import { s } from './roomStyles'
import { VIRTUAL_PRESETS } from './roomUtils'

export function BackgroundMenu({ effect, presetId, flip, blurLevel, uploadedImageName, onEffect, onPreset, onFlip, onBlur, onImageUpload, onImageRemove, onClose }: {
  effect: 'none' | 'blur' | 'image' | 'virtual'
  presetId: string
  flip: boolean
  blurLevel: number
  uploadedImageName: string
  onEffect: (e: 'none' | 'blur' | 'image' | 'virtual') => void
  onPreset: (id: string) => void
  onFlip: () => void
  onBlur: (v: number) => void
  onImageUpload: (file: File) => void
  onImageRemove: () => void
  onClose: () => void
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
          <label style={{ cursor: 'pointer' }}>
            <input
              type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onImageUpload(f) }}
            />
            <div style={s.bgUploadBtn}>
              <Upload size={14} color="#aaa" />
              <span style={{ color: '#aaa', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300 }}>
                {uploadedImageName ? 'Change image' : 'Upload image'}
              </span>
            </div>
          </label>
          {uploadedImageName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ ...s.bgUploadedName, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadedImageName}</div>
              <button
                onClick={onImageRemove}
                title="Remove saved image"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
          {!uploadedImageName && (
            <p style={s.bgHint}>Your photo replaces the background behind you.</p>
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
