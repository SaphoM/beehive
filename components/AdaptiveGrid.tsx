// AdaptiveGrid — replaces <GridLayout> for the main camera tile area.
//
// Rule: the tile shape is determined by LAYOUT BALANCE, not camera state.
//   • Odd tile count  → last tile is the "oversized" tile → rendered as a circle.
//   • Even tile count → every tile is a standard rectangle.
//
// What goes INSIDE the circle is determined by camera state:
//   • Camera ON  → live video clipped to circle (object-fit: cover)
//   • Camera OFF → large avatar centered in circle
//
// Balanced (even) layouts: standard rectangular grid, identical to before.

import React from 'react'
import { ParticipantTile, TrackRefContext, useEnsureTrackRef } from '@livekit/components-react'
import { isTrackReferencePlaceholder, type TrackReferenceOrPlaceholder } from '@livekit/components-core'
import { Avatar } from './Avatar'

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const GAP = 4
const MIN_TILE_WIDTH = 240

const GRID_STYLE = `
.bhv-adaptive-grid {
  display: grid;
  width: 100%;
  height: 100%;
  gap: ${GAP}px;
  box-sizing: border-box;
}
/* Even count or count > 2: auto-fit equal tiles */
.bhv-adaptive-grid.bhv-even {
  grid-template-columns: repeat(auto-fit, minmax(${MIN_TILE_WIDTH}px, 1fr));
  grid-auto-rows: 1fr;
}
/* 1 participant */
.bhv-adaptive-grid.bhv-single {
  grid-template-columns: 1fr;
  grid-auto-rows: 1fr;
}
/* 3, 5, 7 … : 2 even columns; odd tile spans both */
.bhv-adaptive-grid.bhv-odd-multi {
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 1fr;
}

/* Standard rectangular tile wrapper */
.bhv-rect-tile {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  transition: border-radius 0.3s ease;
}

/* Odd-tile row: spans both columns, centres the circle */
.bhv-circle-row {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
}

/* The circular tile container */
.bhv-circle-tile {
  position: relative;
  /* Size: the smaller of 72% of the row width or 72% of the row height */
  width: min(72%, 72vh);
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  overflow: hidden;
  /* Smooth radius transition (e.g. layout changes between 3 and 4 participants) */
  transition: border-radius 0.35s ease, width 0.35s ease;
  background: #1a1a1a;
  flex-shrink: 0;
}

/* Single-participant circle is larger */
.bhv-adaptive-grid.bhv-single .bhv-circle-tile {
  width: min(82%, 78vh);
}

/* Clip video and canvas to fill the circle */
.bhv-circle-tile video,
.bhv-circle-tile canvas {
  object-fit: cover !important;
  width: 100% !important;
  height: 100% !important;
}

/* Keep LiveKit's name/mic badge readable inside the circle */
.bhv-circle-tile .lk-participant-metadata {
  border-radius: 0 0 50% 50%;
}

/* Camera-off avatar overlay inside the circle */
.bhv-circle-off {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
}
`

// Inject styles once at module load time (same pattern as elsewhere in this app).
if (typeof document !== 'undefined' && !document.getElementById('bhv-adaptive-grid-style')) {
  const el = document.createElement('style')
  el.id = 'bhv-adaptive-grid-style'
  el.textContent = GRID_STYLE
  document.head.appendChild(el)
}

// ---------------------------------------------------------------------------
// Camera-off overlay for standard rectangular tiles (unchanged from before)
// ---------------------------------------------------------------------------

function RectCameraOffOverlay({ avatarUrlFor }: { avatarUrlFor: (name: string) => string | null }) {
  const trackRef = useEnsureTrackRef()
  if (!isTrackReferencePlaceholder(trackRef)) return null

  const name = trackRef.participant.name || trackRef.participant.identity
  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1a1a1a',
      }}
    >
      <Avatar name={name} avatarUrl={avatarUrlFor(name)} size={88} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Camera-off overlay for the circular tile — avatar fills the circle
// ---------------------------------------------------------------------------

function CircleCameraOffOverlay({ avatarUrlFor }: { avatarUrlFor: (name: string) => string | null }) {
  const trackRef = useEnsureTrackRef()
  if (!isTrackReferencePlaceholder(trackRef)) return null

  const name = trackRef.participant.name || trackRef.participant.identity
  return (
    <div className="bhv-circle-off">
      <Avatar
        name={name}
        avatarUrl={avatarUrlFor(name)}
        size={160}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdaptiveGrid
// ---------------------------------------------------------------------------

export interface AdaptiveGridProps {
  tracks: TrackReferenceOrPlaceholder[]
  avatarUrlFor: (name: string) => string | null
  style?: React.CSSProperties
}

export function AdaptiveGrid({ tracks, avatarUrlFor, style }: AdaptiveGridProps) {
  const count = tracks.length
  if (count === 0) return null

  const isOddLayout = count % 2 === 1
  // The "oversized" (circular) tile is only the last one in an odd layout.
  const circleIndex = isOddLayout ? count - 1 : -1

  let gridClass: string
  if (count === 1) gridClass = 'bhv-single'
  else if (isOddLayout) gridClass = 'bhv-odd-multi'
  else gridClass = 'bhv-even'

  return (
    <div className={`bhv-adaptive-grid ${gridClass}`} style={style}>
      {tracks.map((track, i) => {
        const isCircle = i === circleIndex

        // Stable key: identity + source; same participant stays mounted
        // across layout changes (preserving WebRTC subscriptions).
        const key = `${track.participant.identity}::${track.source}`

        return (
          <TrackRefContext.Provider key={key} value={track}>
            {isCircle ? (
              // ── Oversized / circular tile ──────────────────────────────────
              <div className="bhv-circle-row">
                <div className="bhv-circle-tile">
                  <ParticipantTile style={{ width: '100%', height: '100%' }} />
                  <CircleCameraOffOverlay avatarUrlFor={avatarUrlFor} />
                </div>
              </div>
            ) : (
              // ── Standard rectangular tile ──────────────────────────────────
              <div className="bhv-rect-tile">
                <ParticipantTile style={{ width: '100%', height: '100%' }} />
                <RectCameraOffOverlay avatarUrlFor={avatarUrlFor} />
              </div>
            )}
          </TrackRefContext.Provider>
        )
      })}
    </div>
  )
}
