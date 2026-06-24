import { X, FlipHorizontal, Upload } from 'lucide-react'
import { s } from './roomStyles'
import { VIRTUAL_PRESETS } from './roomUtils'

export function BackgroundMenu({ effect, presetId, flip, blurLevel, uploadedImageName, onEffect, onPreset, onFlip, onBlur, onImageUpload, onClose }: {
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
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
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
            <div style={s.bgUploadedName}>{uploadedImageName}</div>
          )}
          {!uploadedImageName && (
            <p style={s.bgHint}>Your photo replaces the background behind you.</p>
          )}
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
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
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
