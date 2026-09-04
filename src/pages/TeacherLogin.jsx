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
      <div style={{ display: 'flex', alignItems: 'center', padding: '26px 44px', borderBottom: '2px solid #131311' }}>
        <span style={{ fontWeight: 800, fontSize: 21, letterSpacing: '-.6px' }}>
          QUIZLOCK<span style={{ color: '#e5322d' }}>.</span>
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <form onSubmit={submit} style={{ width: 380, maxWidth: '100%' }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 6px' }}>
            {mode === 'login' ? 'Teacher login' : 'Create account'}
          </h1>
          <p className="label" style={{ marginBottom: 24 }}>
            {mode === 'login' ? 'Sign in to build quizzes' : 'Sign up to start'}
          </p>

          {!isConfigured && (
            <p style={{ background: '#fdecec', border: '2px solid #e5322d', padding: 12, fontSize: 13, marginBottom: 16 }}>
              Supabase is not configured yet. Fill in your <b>.env</b> file (see README).
            </p>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="t-email">Email</label>
            <input id="t-email" className="field" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 6 }} />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label className="label" htmlFor="t-pass">Password</label>
            <input id="t-pass" className="field" type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 6 }} />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'PLEASE WAIT…' : mode === 'login' ? 'LOG IN →' : 'SIGN UP →'}
          </button>

          {msg && <p style={{ fontSize: 13, color: '#c72620', marginTop: 14 }}>{msg}</p>}

          <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: 20, fontFamily: "'Space Mono',monospace", fontSize: 12, color: '#757064', textDecoration: 'underline' }}>
            {mode === 'login' ? "No account? Sign up" : 'Have an account? Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
