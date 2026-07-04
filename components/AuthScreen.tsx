import { useState, FormEvent } from 'react'
import { useAuth } from '../livekit_react_hooks'
import { REQUEST_ACCESS_EMAIL, REQUEST_ACCESS_MAILTO } from './roomUtils'

type Mode = 'login' | 'register'
type Step = 'email' | 'otp' | 'magic_sent'

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

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setErr(null)
    setBusy(true)

    if (isElectron) {
      // Electron: OTP only (magic links open in system browser, not ideal)
      const { error } = await signInWithOtp(email)
      if (error) { setErr(error); setBusy(false); return }
      setStep('otp')
    } else {
      // Web: default to magic link; OTP available via "Use code instead"
      const { error } = await signInWithMagicLink(email)
      if (error) { setErr(error); setBusy(false); return }
      setStep('magic_sent')
    }
    setBusy(false)
  }

  async function handleUseOtpInstead() {
    setErr(null)
    setBusy(true)
    const { error } = await signInWithOtp(email)
    if (error) { setErr(error); setBusy(false); return }
    setStep('otp')
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

  function reset() { setStep('email'); setOtp(''); setErr(null) }

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
            <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <p style={c.label}>Email address</p>
                <input
                  style={c.input}
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                />
              </div>

              {err && <p style={c.error}>{err}</p>}

              <button style={c.primaryBtn} type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : isElectron ? 'Send code' : 'Send magic link'}
              </button>

              {!isElectron && (
                <>
                  <p style={c.divider}>— or —</p>
                  <button style={c.ghostBtn} type="button" onClick={handleUseOtpInstead} disabled={busy || !email.trim()}>
                    Send code instead
                  </button>
                </>
              )}
            </form>
          )}

          {step === 'magic_sent' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={c.success}>
                Magic link sent to<br />
                <strong>{email}</strong><br />
                Click the link in your email to sign in.
              </p>
              <button style={c.ghostBtn} type="button" onClick={handleUseOtpInstead} disabled={busy}>
                {busy ? 'Sending…' : 'Use code instead'}
              </button>
              <button style={c.ghostBtn} type="button" onClick={reset}>
                Use a different email
              </button>
            </div>
          )}

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
    </div>
  )
}
