import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, rpc, isConfigured } from '../lib/supabase'
import { useProctoring } from '../hooks/useProctoring'
import { useRecorder } from '../hooks/useRecorder'
import Timer from '../components/Timer'
import Question from '../components/Question'
import CameraPreview from '../components/CameraPreview'

const ERRORS = {
  quiz_not_found: 'This quiz link is not valid. Please check the link from your teacher.',
  quiz_closed: 'This quiz is closed right now.',
  already_submitted: 'You have already taken this quiz. It can only be taken once.',
  blocked: 'Your quiz is locked because you left the screen. Ask your teacher to re-allow you.',
  not_enough_questions: "The teacher hasn't added enough questions yet. Please tell them.",
  bad_token: 'Your session expired. Please start again.',
}
const friendly = (e) => ERRORS[e] || e || 'Something went wrong.'

export default function QuizFlow() {
  const { quizId } = useParams()
  const [step, setStep] = useState('entry') // entry | permission | quiz | submitting | done
  const [auth, setAuth] = useState(null) // { student_id, token }
  const [form, setForm] = useState({ name: '', email: '', student_id: '' })
  const [data, setData] = useState(null) // questions + meta
  const [answers, setAnswers] = useState({})
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnMsg, setWarnMsg] = useState('')
  const [uploadNote, setUploadNote] = useState('Uploading your recording…')

  const recorder = useRecorder()
  const warnCount = useRef(0)
  const saveTimers = useRef({})

  // ---- proctoring (only active during the quiz) ----
  const { enterFullscreen, exitFullscreen } = useProctoring(step === 'quiz', () => {
    warnCount.current += 1
    if (auth) rpc('record_warning', { p_student_id: auth.student_id, p_token: auth.token }).catch(() => {})
    if (warnCount.current >= 2) submit('left-screen', true)
    else setWarnMsg('Warning: do not leave the exam screen. If it happens again, your quiz will be submitted automatically.')
  })

  // ---- resume after refresh (same student, must re-grant camera) ----
  useEffect(() => {
    const saved = sessionStorage.getItem(`ql_${quizId}`)
    if (saved) {
      try { setAuth(JSON.parse(saved)); setStep('permission') } catch { /* ignore */ }
    }
  }, [quizId])

  // ---------- STEP 1: register ----------
  async function register(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const res = await rpc('register_student', {
        p_quiz_id: quizId, p_name: form.name.trim(),
        p_email: form.email.trim(), p_student_id: form.student_id.trim(),
      })
      const a = { student_id: res.student_id, token: res.token }
      setAuth(a)
      sessionStorage.setItem(`ql_${quizId}`, JSON.stringify(a))
      setStep('permission')
    } catch (e2) { setErr(friendly(e2.message)) }
    finally { setBusy(false) }
  }

  // ---------- STEP 2: permissions + begin ----------
  async function begin() {
    setErr(''); setBusy(true)
    try {
      await recorder.requestMedia() // throws if camera/mic denied
    } catch {
      setErr('You must allow your camera and microphone to take this exam. Please allow access and try again.')
      setBusy(false)
      return
    }
    try {
      recorder.start()
      await enterFullscreen()
      const q = await rpc('get_quiz_for_student', { p_student_id: auth.student_id, p_token: auth.token })
      if (q.error) throw new Error(q.error)
      const initial = {}
      ;(q.questions || []).forEach((qq) => { if (qq.response != null) initial[qq.id] = qq.response })
      setAnswers(initial)
      setData(q)
      setIdx(0)
      setStep('quiz')
    } catch (e2) { setErr(friendly(e2.message)); setBusy(false) }
    finally { setBusy(false) }
  }

  // ---------- answering ----------
  function setAnswer(qid, val) {
    setAnswers((a) => ({ ...a, [qid]: val }))
    clearTimeout(saveTimers.current[qid])
    saveTimers.current[qid] = setTimeout(() => {
      rpc('save_answer', { p_student_id: auth.student_id, p_token: auth.token, p_question_id: qid, p_response: String(val) }).catch(() => {})
    }, 700)
  }

  // ---------- STEP 4: submit ----------
  async function submit(reason, auto = false) {
    if (step === 'submitting' || step === 'done') return
    if (!auto && !window.confirm('Submit your quiz? You cannot change answers after this.')) return
    setStep('submitting')
    try {
      // flush any pending answer saves
      Object.values(saveTimers.current).forEach(clearTimeout)
      await Promise.all(Object.entries(answers).map(([qid, val]) =>
        rpc('save_answer', { p_student_id: auth.student_id, p_token: auth.token, p_question_id: qid, p_response: String(val) }).catch(() => {})
      ))
      setUploadNote('Finishing your recording…')
      await recorder.stop()
      setUploadNote('Uploading your recording… (this can take a moment)')
      const urls = await recorder.uploadAll(auth.student_id)
      await rpc('set_recording_urls', { p_student_id: auth.student_id, p_token: auth.token, p_camera: urls.cameraUrl, p_screen: urls.screenUrl }).catch(() => {})
      await rpc('finish_quiz', { p_student_id: auth.student_id, p_token: auth.token, p_reason: reason })
      supabase.functions.invoke('send-report-email', { body: { student_id: auth.student_id, token: auth.token } }).catch(() => {})
      sessionStorage.removeItem(`ql_${quizId}`)
      await exitFullscreen()
      setStep('done')
    } catch (e2) {
      // Even if something fails, the attempt is over — show done with a note.
      setErr(friendly(e2.message))
      await exitFullscreen()
      setStep('done')
    }
  }

  // =================== RENDER ===================
  if (!isConfigured) return <Center><p>Supabase isn't configured yet. See the README.</p></Center>

  if (step === 'entry') {
    return (
      <Center>
        <form onSubmit={register} style={{ width: 420, maxWidth: '100%' }}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>QUIZLOCK<span style={{ color: '#e5322d' }}>.</span></span>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1px', margin: '18px 0 4px' }}>Enter the exam</h1>
          <p className="label" style={{ marginBottom: 22 }}>Fill your details to begin</p>
          <Field label="Full name" v={form.name} on={(v) => setForm({ ...form, name: v })} required />
          <Field label="Email" type="email" v={form.email} on={(v) => setForm({ ...form, email: v })} required />
          <Field label="Student ID (if you have one)" v={form.student_id} on={(v) => setForm({ ...form, student_id: v })} />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'PLEASE WAIT…' : 'CONTINUE →'}
          </button>
          {err && <p style={{ color: '#c72620', marginTop: 14, fontSize: 14 }}>{err}</p>}
        </form>
      </Center>
    )
  }

  if (step === 'permission') {
    return (
      <Center>
        <div style={{ width: 480, maxWidth: '100%' }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', margin: '0 0 14px' }}>Before you start</h1>
          <ul style={{ fontSize: 16, lineHeight: 1.7, paddingLeft: 20 }}>
            <li>Your <b>camera, microphone and screen</b> will be recorded the whole time.</li>
            <li>The exam opens in <b>fullscreen</b>. Do not switch tabs or leave.</li>
            <li>You get <b>one warning</b>. Leaving again submits your quiz automatically.</li>
            <li>You can take this quiz <b>only once</b>.</li>
          </ul>
          <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: '#757064', margin: '14px 0 22px' }}>
            When you click begin, your browser will ask to share your screen — choose your <b>entire screen</b>.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={begin}>
            {busy ? 'STARTING…' : 'ALLOW & BEGIN EXAM →'}
          </button>
          {err && <p style={{ color: '#c72620', marginTop: 14, fontSize: 14 }}>{err}</p>}
        </div>
      </Center>
    )
  }

  if (step === 'submitting') {
    return <Center><p style={{ fontFamily: "'Space Mono',monospace" }}>{uploadNote}</p></Center>
  }

  if (step === 'done') {
    return (
      <Center>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: 54 }}>✓</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px', margin: '8px 0' }}>Quiz submitted</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6 }}>
            Your recording is being sent to you and your teacher by email. You can close this tab now.
          </p>
          {err && <p style={{ color: '#757064', fontSize: 13, marginTop: 12 }}>Note: {err}</p>}
        </div>
      </Center>
    )
  }

  // ---------- STEP 3: the quiz ----------
  const questions = data?.questions || []
  const q = questions[idx]
  const total = questions.length

  return (
    <div style={{ width: '100%', minHeight: '100%', background: '#f2f1ec', color: '#131311', display: 'flex', flexDirection: 'column' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 44px', borderBottom: '2px solid #131311', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 20 }}>QUIZLOCK<span style={{ color: '#e5322d' }}>.</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <span className="label" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data?.quiz_title}</span>
          {data?.started_at && <Timer startedAt={data.started_at} durationMinutes={data.duration_minutes} onExpire={() => submit('time-up', true)} />}
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: 'flex', padding: '46px 44px', boxSizing: 'border-box', gap: 44, flexWrap: 'wrap' }}>
        <div style={{ width: 560, flexShrink: 0, minWidth: 300 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <span style={{ fontWeight: 800, fontSize: 130, lineHeight: .8, letterSpacing: '-5px' }}>{String(idx + 1).padStart(2, '0')}</span>
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 14, color: '#757064', marginTop: 10, letterSpacing: 1 }}>/ {total}<br />QUESTIONS</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: 40, lineHeight: 1.1, margin: '26px 0 0', letterSpacing: '-1.2px', maxWidth: 520 }}>{q?.prompt}</h1>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, letterSpacing: 1, color: '#757064', marginTop: 22 }}>
            {q?.type === 'mcq' ? 'SELECT ONE ANSWER' : q?.type === 'code' ? 'WRITE YOUR CODE' : 'WRITE YOUR ANSWER'}
          </div>
        </div>

        <div style={{ flex: 1, borderLeft: '2px solid #131311', paddingLeft: 44, minWidth: 320 }}>
          {q && <Question q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 40, flexWrap: 'wrap' }}>
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>&larr; BACK</button>
            {idx < total - 1
              ? <button className="btn btn-primary" onClick={() => setIdx(idx + 1)}>NEXT QUESTION &rarr;</button>
              : <button className="btn btn-primary" onClick={() => submit('finished')}>SUBMIT QUIZ ✓</button>}
            <span className="label" style={{ marginLeft: 'auto' }}>{Object.keys(answers).length}/{total} answered</span>
          </div>
        </div>
      </div>

      <CameraPreview stream={recorder.cameraStream} screen={recorder.hasScreen} />

      {warnMsg && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}>
          <div style={{ background: '#f2f1ec', border: '3px solid #e5322d', padding: 36, maxWidth: 460 }}>
            <div className="label" style={{ color: '#e5322d' }}>Warning 1 of 1</div>
            <h2 style={{ fontSize: 26, fontWeight: 800, margin: '10px 0 12px', letterSpacing: '-.5px' }}>Stay on the exam</h2>
            <p style={{ fontSize: 15, lineHeight: 1.5 }}>{warnMsg}</p>
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={async () => { setWarnMsg(''); await enterFullscreen() }}>
              GOT IT — CONTINUE →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- small helpers ----
function Center({ children }) {
  return <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</div>
}
function Field({ label, v, on, type = 'text', required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label">{label}</label>
      <input className="field" type={type} required={required} value={v}
        onChange={(e) => on(e.target.value)} style={{ marginTop: 6 }} />
    </div>
  )
}
