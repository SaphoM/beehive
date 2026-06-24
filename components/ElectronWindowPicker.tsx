import { useState } from 'react'
import { X } from 'lucide-react'

export function ElectronWindowPicker({ sources, onConfirm, onClose, onRefresh }: {
  sources: Array<{ id: string; name: string; thumbnail: string; appIcon: string | null; display_id: string }>
  onConfirm: (src: { id: string; name: string; thumbnail: string }) => void
  onClose: () => void
  onRefresh: () => void
}) {
  const [selected, setSelected] = useState<{ id: string; name: string; thumbnail: string } | null>(null)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: '90vw', maxWidth: 960, maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}>Select Window to Share</span>
            <p style={{ color: '#555', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: '4px 0 0' }}>
              Click to select · Double-click or press Confirm to share
            </p>
          </div>
          <button style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', flexShrink: 0 }} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, paddingRight: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {sources.map(src => {
              const isSelected = selected?.id === src.id
              return (
                <button
                  key={src.id}
                  onClick={() => {
                    if (isSelected) {
                      onConfirm({ id: src.id, name: src.name, thumbnail: src.thumbnail })
                    } else {
                      setSelected({ id: src.id, name: src.name, thumbnail: src.thumbnail })
                    }
                  }}
                  onDoubleClick={() => onConfirm({ id: src.id, name: src.name, thumbnail: src.thumbnail })}
                  style={{
                    background: isSelected ? '#1e2a1e' : '#1a1a1a',
                    border: `2px solid ${isSelected ? '#48bb78' : '#2a2a2a'}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column' as const,
                    textAlign: 'left' as const,
                    transition: 'border-color 0.1s',
                    outline: 'none',
                  }}
                >
                  <img
                    src={src.thumbnail}
                    alt={src.name}
                    style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block', background: '#111' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
                    {src.appIcon && <img src={src.appIcon} alt="" style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0 }} />}
                    <span style={{ color: isSelected ? '#48bb78' : '#ccc', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{src.name}</span>
                    {isSelected && <span style={{ marginLeft: 'auto', color: '#48bb78', fontSize: 10, flexShrink: 0 }}>Selected</span>}
                  </div>
                </button>
              )
            })}
            {sources.length === 0 && (
              <div style={{ gridColumn: '1/-1', color: '#555', fontSize: 13, textAlign: 'center' as const, padding: 48 }}>
                No windows found. Make sure your presentation is open.
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button
            style={{ flex: 1, background: 'none', border: '1px solid #2a2a2a', borderRadius: 10, color: '#666', padding: '10px 0', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            disabled={!selected}
            style={{ flex: 2, background: selected ? '#276127' : '#1a1a1a', border: `1px solid ${selected ? '#48bb78' : '#2a2a2a'}`, borderRadius: 10, color: selected ? '#48bb78' : '#444', padding: '10px 0', fontSize: 13, fontWeight: 400, cursor: selected ? 'pointer' : 'default', fontFamily: "'Roboto', sans-serif", transition: 'all 0.15s' }}
            onClick={() => selected && onConfirm(selected)}
          >
            {selected ? `Share "${selected.name.slice(0, 28)}${selected.name.length > 28 ? '…' : ''}"` : 'Select a window above'}
          </button>
        </div>
      </div>
    </div>
  )
}
