import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'

export default function TeacherLogin() {
  const nav = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setMsg('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Account created. If email confirmation is on, check your inbox, then log in.')
        setMode('login')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        nav('/teacher')
      }
    } catch (err) {
      setMsg(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '18px 28px', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
        <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>
          QUIZLOCK<span style={{ color: 'var(--accent)' }}>.</span>
        </span>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <form onSubmit={submit} className="card" style={{ width: 400, maxWidth: '100%', padding: 28 }}>
          <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 4px' }}>
            {mode === 'login' ? 'Teacher login' : 'Create account'}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 22px' }}>
            {mode === 'login' ? 'Sign in to build and run your quizzes.' : 'Sign up to start creating quizzes.'}
          </p>

          {!isConfigured && (
            <p style={{ background: 'var(--bad-bg)', border: '1px solid var(--bad)', color: 'var(--bad)', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
              Supabase isn't configured yet — fill in your <b>.env</b> file (see README).
            </p>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="t-email">Email</label>
            <input id="t-email" className="field" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 6 }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="t-pass">Password</label>
            <input id="t-pass" className="field" type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 6 }} />
          </div>

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>

          {msg && <p role="alert" style={{ fontSize: 13, color: 'var(--accent)', marginTop: 14 }}>{msg}</p>}

          <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: 18, fontSize: 13, color: 'var(--muted)', textDecoration: 'underline', padding: 0 }}>
            {mode === 'login' ? 'No account? Sign up' : 'Have an account? Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
