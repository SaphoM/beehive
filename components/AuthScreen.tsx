import { useState, useEffect, useRef, FormEvent } from 'react'
import { useAuth } from '../livekit_react_hooks'
import { REQUEST_ACCESS_EMAIL, REQUEST_ACCESS_MAILTO } from './roomUtils'
import { BuiltByFooter } from './BuiltByFooter'

type Mode = 'login' | 'register'
type Step = 'email' | 'otp'

const c: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: 'var(--vh, 100vh)',
    background: '#0a0a0a', fontFamily: "'Roboto', sans-serif",
  },
  scene: {
    perspective: 900, width: 340, position: 'relative',
  },
  card: {
    background: '#111', border: '1px solid #222', borderRadius: 16,
    padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 20,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    transformStyle: 'preserve-3d',
    transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
  },
  logo: {
    color: '#fff', fontWeight: 300, fontSize: 22, letterSpacing: 6,
    textTransform: 'uppercase', textAlign: 'center', marginBottom: 4,
  },
  logoAccent: { fontWeight: 400 },
  subtitle: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 8 },
  label: { color: '#888', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  input: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    color: '#fff', fontSize: 15, padding: '11px 14px', width: '100%', outline: 'none',
    boxSizing: 'border-box',
  },
  primaryBtn: {
    background: '#f5a623', color: '#000', border: 'none', borderRadius: 8,
    fontWeight: 600, fontSize: 14, padding: '13px 0', cursor: 'pointer',
    width: '100%', letterSpacing: 0.5,
    transition: 'opacity 0.15s',
  },
  ghostBtn: {
    background: 'transparent', color: '#666', border: '1px solid #333',
    borderRadius: 8, fontWeight: 400, fontSize: 13, padding: '11px 0',
    cursor: 'pointer', width: '100%',
  },
  modeSwitch: {
    color: '#555', fontSize: 12, textAlign: 'center',
    display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center',
  },
  modeSwitchLink: {
    color: '#f5a623', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0,
  },
  error: {
    color: '#f55', fontSize: 12, background: 'rgba(255,80,80,0.08)',
    border: '1px solid rgba(255,80,80,0.2)', borderRadius: 6, padding: '8px 12px',
  },
  success: {
    color: '#5f5', fontSize: 12, background: 'rgba(80,255,80,0.06)',
    border: '1px solid rgba(80,255,80,0.15)', borderRadius: 6, padding: '8px 12px',
    textAlign: 'center', lineHeight: 1.6,
  },
  betaBadge: {
    display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 999,
    background: 'rgba(245,197,24,0.12)', border: '1px solid rgba(245,197,24,0.4)',
    color: '#f5a623', fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
    verticalAlign: 'middle',
  },
  betaNote: {
    color: '#999', fontSize: 12.5, lineHeight: 1.6, textAlign: 'center',
    background: 'rgba(245,197,24,0.05)', border: '1px solid rgba(245,197,24,0.18)',
    borderRadius: 8, padding: '12px 14px',
  },
  divider: { color: '#333', fontSize: 11, textAlign: 'center', position: 'relative' },
  otpRow: { display: 'flex', gap: 8 },
  otpInput: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    color: '#fff', fontSize: 22, fontWeight: 600, padding: '11px 0',
    width: '100%', textAlign: 'center', outline: 'none', letterSpacing: 2,
  },
}

export function AuthScreen({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const { signInWithMagicLink, signInWithOtp, verifyOtp } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Web only: the magic link and code are two ways to finish the SAME sign-in,
  // not two separate screens — sending one no longer replaces the form, so a
  // code request/entry sits directly under the magic-link button and either
  // one can still be used. `magicSent` and `otpRequested` are independent
  // (both can be true at once, e.g. sent a magic link, then also requested a
  // code) rather than a single step, since either path can complete the sign-in.
  const [magicSent, setMagicSent] = useState(false)
  const [otpRequested, setOtpRequested] = useState(false)
  // Shared 15s cooldown across every action that sends another email for
  // the same sign-in attempt ("Send code instead" and "Resend magic link").
  // A magic-link email already carries both the link AND the 6-digit code
  // (see signInWithOtp's own comment), so firing any of these again right
  // after a send was producing a fully redundant email through the same
  // low per-project rate limit. Armed imperatively (not via a state-change
  // effect) so every sender — the initial magic link, a resend, or a code
  // request — can (re)start the same countdown, not just the first one.
  const [sendCooldown, setSendCooldown] = useState(0)
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startCooldown() {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    setSendCooldown(15)
    cooldownTimerRef.current = setInterval(() => {
      setSendCooldown(prev => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
          cooldownTimerRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // Belt-and-braces: clear any running interval if the screen unmounts
  // mid-countdown (e.g. sign-in completes via a different tab) so it can't
  // keep ticking against a detached component.
  useEffect(() => () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current) }, [])

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setErr(null)
    setBusy(true)

    if (isElectron) {
      // Electron: OTP only (magic links open in system browser, not ideal) —
      // no magic-link button to sit next to here, so this keeps its own step.
      const { error } = await signInWithOtp(email)
      if (error) { setErr(error); setBusy(false); return }
      setStep('otp')
    } else {
      // Web: sends the magic link and shows its confirmation inline, without
      // leaving this screen — "Send code instead" (below) remains available.
      const { error } = await signInWithMagicLink(email)
      if (error) { setErr(error); setBusy(false); return }
      setMagicSent(true)
      startCooldown()
    }
    setBusy(false)
  }

  async function handleUseOtpInstead() {
    setErr(null)
    setBusy(true)
    const { error } = await signInWithOtp(email)
    if (error) { setErr(error); setBusy(false); return }
    setOtpRequested(true)
    startCooldown()
    setBusy(false)
  }

  // Same underlying send as the initial "Send magic link" — gated by the
  // shared cooldown above so repeated clicks can't queue up several emails
  // in a row.
  async function handleResendMagicLink() {
    setErr(null)
    setBusy(true)
    const { error } = await signInWithMagicLink(email)
    if (error) { setErr(error); setBusy(false); return }
    startCooldown()
    setBusy(false)
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault()
    if (otp.length < 8) return
    setErr(null)
    setBusy(true)
    const { error } = await verifyOtp(email, otp)
    if (error) { setErr(error); setBusy(false); return }
    setBusy(false)
    onAuthenticated?.()
  }

  function reset() {
    setStep('email'); setMagicSent(false); setOtpRequested(false); setOtp(''); setErr(null)
    if (cooldownTimerRef.current) { clearInterval(cooldownTimerRef.current); cooldownTimerRef.current = null }
    setSendCooldown(0)
  }

  return (
    <div style={c.root}>
      <div style={c.scene}>
        <div style={c.card}>
          <div>
            <h1 style={c.logo}>
              <span style={c.logoAccent}>BEE</span>HIVE
            </h1>
            <p style={c.subtitle}>
              {mode === 'login' ? 'Sign in to continue' : 'Request Beta access'}
            </p>
          </div>

          {step === 'email' && mode === 'register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={c.betaNote}>
                BeeHive is in private <strong style={{ color: '#f5a623' }}>Beta</strong>. Accounts are
                provisioned by X&nbsp;Spark — request access and we'll set you up.
              </p>
              <a
                href={REQUEST_ACCESS_MAILTO}
                style={{ ...c.primaryBtn, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
              >
                Request access from X Spark
              </a>
              <p style={{ color: '#555', fontSize: 11, textAlign: 'center' }}>
                {REQUEST_ACCESS_EMAIL}
              </p>
            </div>
          )}

          {step === 'email' && mode === 'login' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <p style={c.label}>Email address</p>
                  <input
                    style={c.input}
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={magicSent || otpRequested}
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                {err && !otpRequested && <p style={c.error}>{err}</p>}

                {isElectron ? (
                  <button style={c.primaryBtn} type="submit" disabled={busy || !email.trim()}>
                    {busy ? 'Sending…' : 'Send code'}
                  </button>
                ) : magicSent ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={c.success}>Magic link sent to <strong>{email}</strong> — click the link in your email to sign in.</p>
                    <button style={c.ghostBtn} type="button" onClick={handleResendMagicLink} disabled={busy || sendCooldown > 0}>
                      {sendCooldown > 0 ? `Resend magic link (${sendCooldown}s)` : 'Resend magic link'}
                    </button>
                  </div>
                ) : (
                  <button style={c.primaryBtn} type="submit" disabled={busy || !email.trim()}>
                    {busy ? 'Sending…' : 'Send magic link'}
                  </button>
                )}
              </form>

              {/* Code entry sits directly under the magic-link button rather than
                  replacing it — either can finish the same sign-in, so requesting
                  a code (or the magic link) doesn't take the other option away. */}
              {!isElectron && (
                <>
                  <p style={c.divider}>— or —</p>
                  {otpRequested ? (
                    <form onSubmit={handleOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <p style={{ ...c.success, marginBottom: 0 }}>Code sent to <strong>{email}</strong></p>
                      <div>
                        <p style={c.label}>Verification code</p>
                        <input
                          style={c.otpInput}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={8}
                          placeholder="00000000"
                          value={otp}
                          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          autoFocus
                          autoComplete="one-time-code"
                        />
                      </div>
                      {err && <p style={c.error}>{err}</p>}
                      <button style={c.primaryBtn} type="submit" disabled={busy || otp.length < 8}>
                        {busy ? 'Verifying…' : 'Verify code'}
                      </button>
                    </form>
                  ) : (
                    <button style={c.ghostBtn} type="button" onClick={handleUseOtpInstead} disabled={busy || !email.trim() || sendCooldown > 0}>
                      {sendCooldown > 0 ? `Send code instead (${sendCooldown}s)` : 'Send code instead'}
                    </button>
                  )}
                </>
              )}

              {(magicSent || otpRequested) && (
                <button style={c.ghostBtn} type="button" onClick={reset}>
                  Use a different email
                </button>
              )}
            </div>
          )}

          {/* Electron only — OTP is the sole sign-in method there (no magic
              link to sit next to; see handleEmailSubmit's isElectron branch),
              so it keeps its own dedicated step. */}
          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ ...c.success, marginBottom: 0 }}>
                Code sent to <strong>{email}</strong>
              </p>
              <div>
                <p style={c.label}>Verification code</p>
                <input
                  style={c.otpInput}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  // This project's Supabase Auth issues an 8-digit OTP (confirmed via
                  // admin generate_link — email_otp is consistently 8 chars), not the
                  // 6-digit default. Capping input at 6 made manual code entry
                  // impossible: the last 2 digits could never be typed, so
                  // verifyOtp always failed and sent the user back to this screen.
                  maxLength={8}
                  placeholder="00000000"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              {err && <p style={c.error}>{err}</p>}

              <button style={c.primaryBtn} type="submit" disabled={busy || otp.length < 8}>
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
              <button style={c.ghostBtn} type="button" onClick={reset}>
                Back
              </button>
            </form>
          )}

          {step === 'email' && (
            <p style={c.modeSwitch}>
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
              <button
                style={c.modeSwitchLink}
                type="button"
                onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setErr(null); setStep('email') }}
              >
                {mode === 'login' ? 'Register' : 'Sign in'}
                {mode === 'login' && <span style={c.betaBadge}>Beta</span>}
              </button>
            </p>
          )}
        </div>
      </div>
      <BuiltByFooter />
    </div>
  )
}
