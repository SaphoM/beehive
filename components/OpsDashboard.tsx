import { useCallback, useEffect, useState } from 'react'
import { Activity, Database, Radio, Users, Mic, Video, MicOff, Power, ShieldCheck, RefreshCw, ArrowLeft, CheckCircle2, AlertTriangle, Circle } from 'lucide-react'
import { supabase } from '../livekit_react_hooks'

// ============================================================
// Ops Dashboard — integrations + large-session control (admin only)
// ============================================================
// Backed by GET /api/admin/overview (one call, polled). Shows whether the
// two integrations a large session depends on are live and on a plan that
// can carry it, what LiveKit is hosting right now, and the readiness
// checklist from the capacity audit. Session controls call the admin
// endpoints (mute all / end), which are authorised by the caller's admin
// role, not a per-room host secret.
//
// Visual: the reference layout (light card dashboard) in BeeHive's own
// swatch — white ground, warm neutrals, amber #f5a623 as the primary,
// and the app's near-black for the one "dark card" the reference uses
// for its task list, which here is the readiness checklist.

const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001' : ''

type Plan = { label: string; realtimePeakConnections?: number; realtimeMessagesPerSec?: number; maxParticipantsPerRoom?: number | null; note?: string }
type Overview = {
  generatedAt: string
  target: number
  limits: { maxLiveMics: number; recommendedMaxCameras: number }
  integrations: {
    supabase: { projectRef: string | null; planKey: string | null; plan: Plan | null; reachable: boolean; latencyMs: number | null; region: string }
    livekit:  { url: string | null; planKey: string | null; plan: Plan | null; reachable: boolean; latencyMs: number | null; activeRooms: number }
  }
  totals: { participants: number; mics: number; cameras: number }
  sessions: Array<{ livekitRoomName: string; roomId: string | null; name: string; requiresAdmission: boolean; audienceMode: boolean; pendingAdmissions: number; participants: number; publishers: { mics: number; cameras: number; screens: number }; startedAt: string | null; hosts: string[] }>
  readiness: Array<{ id: string; status: 'done' | 'warn' | 'todo'; label: string; detail: string }>
  readinessScore: { done: number; total: number }
}

const AMBER = '#f5a623'
const INK = '#141414'
const c = {
  page: { minHeight: '100vh', background: '#F6F5F2', color: INK, fontFamily: "'Roboto', sans-serif", padding: '24px 28px 48px' } as React.CSSProperties,
  card: { background: '#fff', border: '1px solid #ECEAE4', borderRadius: 16, padding: 20, boxShadow: '0 1px 2px rgba(20,20,20,0.03)' } as React.CSSProperties,
  label: { fontSize: 12, color: '#7A776F', fontWeight: 400 } as React.CSSProperties,
  big: { fontSize: 34, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: 'tabular-nums' } as React.CSSProperties,
  chip: (bg: string, fg: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: fg, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 500 } as React.CSSProperties),
  btn: (kind: 'primary' | 'ghost' | 'danger') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'Roboto', sans-serif",
    ...(kind === 'primary' ? { background: AMBER, color: INK, border: 'none' }
      : kind === 'danger' ? { background: '#fff', color: '#B42318', border: '1px solid #F3C6C1' }
      : { background: '#fff', color: INK, border: '1px solid #E4E1DA' }),
  } as React.CSSProperties),
}

function StatusDot({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null ? '#B8B4AA' : ok ? '#1E9E5A' : '#D64545'
  return <span style={c.chip(ok ? '#E8F6EE' : ok === null ? '#F1F0EC' : '#FCEBEB', color)}><span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{label}</span>
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ ...c.card, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: INK, color: AMBER, display: 'grid', placeItems: 'center' }}>{icon}</span>
        <span style={{ fontSize: 13, color: '#3B3934' }}>{label}</span>
      </div>
      <div style={c.big}>{value}</div>
      {sub && <div style={c.label}>{sub}</div>}
    </div>
  )
}

export function OpsDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setToken(session?.access_token ?? null))
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    try {
      const r = await fetch(`${API_BASE}/api/admin/overview`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.status === 403) { setError('Your account does not have the admin role.'); return }
      if (r.status === 401) { setError('Sign in to view operations.'); return }
      if (!r.ok) { setError('Could not load the overview.'); return }
      setData(await r.json()); setError(null)
    } catch { setError('Backend unreachable.') }
  }, [token])

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])

  const act = async (room: string, action: 'mute-all' | 'end') => {
    if (!token) return
    if (action === 'end' && !window.confirm('End this session for everyone?')) return
    setBusy(`${room}:${action}`)
    try { await fetch(`${API_BASE}/api/admin/sessions/${encodeURIComponent(room)}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); await load() }
    finally { setBusy(null) }
  }

  const sb = data?.integrations.supabase, lk = data?.integrations.livekit
  const targetOk = !!(sb?.plan && data && sb.plan.realtimePeakConnections! >= data.target)

  return (
    <div style={c.page}>
      {/* Top bar — mirrors the reference: brand left, pill nav centre, actions right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div style={{ fontSize: 20, letterSpacing: 2 }}><span style={{ fontWeight: 700 }}>BEE</span><span style={{ fontWeight: 300 }}>HIVE</span> <span style={{ ...c.label, marginLeft: 8, letterSpacing: 0 }}>Operations</span></div>
        <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #ECEAE4', borderRadius: 999, padding: 4 }}>
          {['Dashboard', 'Sessions', 'Integrations', 'Readiness'].map((t, i) => (
            <a key={t} href={`#${t.toLowerCase()}`} style={{ textDecoration: 'none', padding: '7px 14px', borderRadius: 999, fontSize: 13, color: i === 0 ? '#fff' : '#3B3934', background: i === 0 ? INK : 'transparent' }}>{t}</a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} title="Refresh" style={c.btn('ghost')}><RefreshCw size={14} /></button>
          <button onClick={onBack} style={c.btn('ghost')}><ArrowLeft size={14} /> Back to BeeHive</button>
        </div>
      </div>

      {error && <div style={{ ...c.card, borderColor: '#F3C6C1', color: '#B42318', marginBottom: 16 }}>{error}</div>}

      {/* Heading + KPI tiles */}
      <div id="dashboard" style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: 16, alignItems: 'start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 400, margin: '6px 0 6px', letterSpacing: -0.3 }}>Large-session readiness</h1>
          <p style={{ ...c.label, margin: 0, maxWidth: 420, lineHeight: 1.5 }}>
            Target <b style={{ color: INK }}>{data?.target ?? 300} attendees</b> in one room. Live figures refresh every 10 s. Plan tiers are declared in the deploy config — neither provider exposes them to an API key.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <StatusDot ok={sb?.reachable ?? null} label={`Supabase ${sb?.latencyMs != null ? sb.latencyMs + ' ms' : ''}`} />
            <StatusDot ok={lk?.reachable ?? null} label={`LiveKit ${lk?.latencyMs != null ? lk.latencyMs + ' ms' : ''}`} />
            <StatusDot ok={data ? targetOk : null} label={targetOk ? 'Plan fits target' : 'Plan below target'} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <Tile icon={<Radio size={15} />} label="Live sessions" value={data?.sessions.length ?? '—'} sub={`${lk?.activeRooms ?? 0} rooms on LiveKit`} />
          <Tile icon={<Users size={15} />} label="Attendees now" value={data?.totals.participants ?? '—'} sub={`of ${data?.target ?? 300} target`} />
          <Tile icon={<Mic size={15} />} label="Mics live" value={data?.totals.mics ?? '—'} sub={`cap ${data?.limits.maxLiveMics ?? 20} per room`} />
          <Tile icon={<Video size={15} />} label="Cameras on" value={data?.totals.cameras ?? '—'} sub={`≤ ${data?.limits.recommendedMaxCameras ?? 25} recommended`} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Integrations */}
          <div id="integrations" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={c.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Database size={16} color={AMBER} /> Supabase</span>
                <StatusDot ok={sb?.reachable ?? null} label={sb?.reachable ? 'Connected' : 'Unreachable'} />
              </div>
              <Row k="Project" v={sb?.projectRef ?? '—'} mono />
              <Row k="Region" v={sb?.region ?? '—'} />
              <Row k="Plan" v={sb?.plan ? sb.plan.label : 'Not declared'} warn={!sb?.plan} />
              <Row k="Realtime peak connections" v={sb?.plan ? String(sb.plan.realtimePeakConnections) : '—'} warn={!!sb?.plan && !targetOk} />
              <Row k="Realtime messages / s" v={sb?.plan ? String(sb.plan.realtimeMessagesPerSec) : '—'} />
              {!sb?.plan && <Hint>Set <code>SUPABASE_PLAN</code> to <code>free | pro | team | enterprise</code> in the deploy config.</Hint>}
              {sb?.plan && !targetOk && <Hint warn>{sb.plan.label} allows {sb.plan.realtimePeakConnections} concurrent realtime connections — attendee #{(sb.plan.realtimePeakConnections ?? 0) + 1} cannot connect. Upgrade before a {data?.target}-person session.</Hint>}
            </div>
            <div style={c.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Activity size={16} color={AMBER} /> LiveKit Cloud</span>
                <StatusDot ok={lk?.reachable ?? null} label={lk?.reachable ? 'Connected' : 'Unreachable'} />
              </div>
              <Row k="Endpoint" v={(lk?.url ?? '—').replace(/^wss:\/\//, '')} mono />
              <Row k="Plan" v={lk?.plan ? lk.plan.label : 'Not declared'} warn={!lk?.plan} />
              <Row k="Participants per room" v="Unlimited (mesh SFU)" />
              <Row k="Active rooms" v={String(lk?.activeRooms ?? '—')} />
              {!lk?.plan && <Hint>Set <code>LIVEKIT_CLOUD_PLAN</code> to <code>build | ship | scale | enterprise</code>.</Hint>}
              {lk?.plan?.note && <Hint warn={lk.planKey === 'build'}>{lk.plan.note}</Hint>}
            </div>
          </div>

          {/* Sessions */}
          <div id="sessions" style={c.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <span style={{ fontSize: 15 }}>Live sessions</span>
              <span style={c.label}>{data ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ''}</span>
            </div>
            {data && data.sessions.length === 0 && <div style={{ ...c.label, padding: '18px 0' }}>No rooms are live on LiveKit right now.</div>}
            {data?.sessions.map(s => {
              const micWarn = s.publishers.mics >= data.limits.maxLiveMics
              const camWarn = s.publishers.cameras > data.limits.recommendedMaxCameras
              const big = s.participants >= 50
              return (
                <div key={s.livekitRoomName} style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 0.6fr) auto', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid #F1F0EC' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                    <div style={{ ...c.label, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                      {s.startedAt && <span>since {new Date(s.startedAt).toLocaleTimeString()}</span>}
                      {s.hosts.length > 0 && <span>host {s.hosts.join(', ')}</span>}
                      {s.requiresAdmission && <span style={c.chip('#FFF4DF', '#8A5A06')}>waiting room{s.pendingAdmissions ? ` · ${s.pendingAdmissions} waiting` : ''}</span>}
                      {s.audienceMode && <span style={c.chip('#141414', AMBER)}>audience mode</span>}
                      {big && !s.audienceMode && <span style={c.chip('#141414', AMBER)}>large session</span>}
                    </div>
                  </div>
                  <Stat n={s.participants} label="attendees" />
                  <Stat n={s.publishers.mics} label="mics" warn={micWarn} />
                  <Stat n={s.publishers.cameras} label="cameras" warn={camWarn} />
                  <Stat n={s.publishers.screens} label="shares" />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={c.btn('ghost')} disabled={busy !== null || s.publishers.mics === 0} onClick={() => act(s.livekitRoomName, 'mute-all')} title="Mute every microphone in this room"><MicOff size={13} /> Mute all</button>
                    <button style={c.btn('danger')} disabled={busy !== null} onClick={() => act(s.livekitRoomName, 'end')} title="End the session for everyone"><Power size={13} /> End</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Readiness — the reference's dark task card, in BeeHive's black + amber */}
        <div id="readiness" style={{ background: INK, color: '#fff', borderRadius: 16, padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={16} color={AMBER} /> Readiness</span>
            <span style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}><b>{data?.readinessScore.done ?? 0}</b><span style={{ color: '#8C8880' }}>/{data?.readinessScore.total ?? 9}</span></span>
          </div>
          <div style={{ height: 6, background: '#2A2A2A', borderRadius: 3, margin: '8px 0 16px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: data ? `${Math.round(100 * data.readinessScore.done / data.readinessScore.total)}%` : '0%', background: AMBER, transition: 'width .3s' }} />
          </div>
          {data?.readiness.map(r => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 12, padding: '11px 0', borderTop: '1px solid #262626' }}>
              <span style={{ paddingTop: 2 }}>
                {r.status === 'done' ? <CheckCircle2 size={18} color={AMBER} /> : r.status === 'warn' ? <AlertTriangle size={18} color="#F0A55A" /> : <Circle size={18} color="#4A4A4A" />}
              </span>
              <div>
                <div style={{ fontSize: 13.5, color: r.status === 'todo' ? '#B8B4AA' : '#fff' }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: '#8C8880', marginTop: 2, lineHeight: 1.45 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: '1px solid #F1F0EC', fontSize: 13 }}>
      <span style={{ color: '#7A776F' }}>{k}</span>
      <span style={{ fontFamily: mono ? 'ui-monospace, SF Mono, Menlo, monospace' : undefined, fontSize: mono ? 12 : 13, color: warn ? '#B42318' : INK, textAlign: 'right' }}>{v}</span>
    </div>
  )
}
function Hint({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: warn ? '#8A5A06' : '#7A776F', background: warn ? '#FFF4DF' : '#F6F5F2', borderRadius: 8, padding: '8px 10px' }}>{children}</div>
}
function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: warn ? '#B42318' : INK }}>{n}</div>
      <div style={c.label}>{label}</div>
    </div>
  )
}
