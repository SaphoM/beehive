// Fills in the one real gap in the avatar rollout: the main meeting grid's
// camera-off state. `RoomPage.tsx`'s <GridLayout><ParticipantTile /></GridLayout>
// uses LiveKit's own default tile rendering, which draws its own built-in
// placeholder (a generic grey person-silhouette SVG, `ParticipantPlaceholder`)
// whenever a participant's camera is off — this app never customized that.
//
// `ParticipantTile`'s `children` prop *replaces* its entire default body
// (video + placeholder + name badge + mic icon + connection quality, all of
// it) rather than overriding just the placeholder — confirmed by reading the
// library's own source (`n.children ?? <defaultBody/>`). Rebuilding all of
// that manually to swap in one piece would risk regressing exactly the
// "existing meeting layout" this task is scoped to leave alone.
//
// Instead: GridLayout clones whatever single child it's given once per track
// and wraps each clone in a per-tile track-reference context (the same
// mechanism its own docs describe for "ParticipantTile as a child of
// TrackLoop"). Wrapping `<ParticipantTile />` in a plain host `<div>` alongside
// this component means both receive that same per-tile context — so this
// renders as a sibling overlay, on top of LiveKit's own DOM, using the exact
// same trackRef LiveKit itself is reading, without touching ParticipantTile,
// GridLayout, or any track/WebRTC logic at all.
import { useEnsureTrackRef } from '@livekit/components-react'
import { isTrackReferencePlaceholder } from '@livekit/components-core'
import { Avatar } from './Avatar'

export function CameraOffAvatarOverlay({ avatarUrlFor }: { avatarUrlFor: (name: string) => string | null }) {
  const trackRef = useEnsureTrackRef()
  // A "placeholder" trackRef is exactly LiveKit's own signal for "no real
  // track to show" (camera off, or never published) — the same condition
  // that makes its default tile draw the grey silhouette this overlay is
  // covering. When there's a real track, render nothing so the actual video
  // underneath is untouched.
  if (!isTrackReferencePlaceholder(trackRef)) return null

  const name = trackRef.participant.name || trackRef.participant.identity

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        background: '#1a1a1a',
      }}
    >
      <Avatar name={name} avatarUrl={avatarUrlFor(name)} size={88} />
      <span style={{ color: '#e2e2e2', fontSize: 13, fontWeight: 400, fontFamily: "'Roboto', sans-serif", textAlign: 'center', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
  )
}
