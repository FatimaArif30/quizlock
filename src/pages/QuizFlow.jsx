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
  already_submitted: 'This Student ID has already taken this quiz. It can only be taken once.',
  blocked: 'Your quiz is locked because you left the screen. Ask your teacher to re-allow you.',
  not_enough_questions: "The teacher hasn't added enough questions yet. Please tell them.",
  student_id_required: 'Please enter your Student ID — it is required.',
  not_open_yet: 'This quiz has not opened yet. Please come back at the start time.',
  bad_token: 'Your session expired. Please start again.',
  not_on_roster: 'Your Student ID is not on the class list for this quiz. Please check with your teacher.',
}
const friendly = (e) => ERRORS[e] || e || 'Something went wrong.'

export default function QuizFlow() {
  const { quizId } = useParams()
  const [step, setStep] = useState('entry') // entry | permission | quiz | submitting | done
  const [auth, setAuth] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', student_id: '' })
  const [data, setData] = useState(null)
  const [answers, setAnswers] = useState({})
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [warnMsg, setWarnMsg] = useState('')
  const [showReview, setShowReview] = useState(false)
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState(null)
  const [recWarn, setRecWarn] = useState(false)
  const [uploadNote, setUploadNote] = useState('Uploading your recording…')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(null)

  const recorder = useRecorder()
  const warnCount = useRef(0)
  const saveTimers = useRef({})
  const mediaReady = useRef(false)

  // proctoring active during the quiz AND the review overlay
  const { enterFullscreen, exitFullscreen } = useProctoring(step === 'quiz', async () => {
    if (!auth) return
    try {
      const r = await rpc('record_warning', { p_student_id: auth.student_id, p_token: auth.token })
      warnCount.current = r.warnings ?? warnCount.current + 1
    } catch { warnCount.current += 1 }
    if (warnCount.current >= 2) submit('left-screen', true)
    else setWarnMsg('Warning: do not leave the exam screen. If it happens again, your quiz will be submitted automatically.')
  })

  useEffect(() => {
    const saved = sessionStorage.getItem(`ql_${quizId}`)
    if (saved) { try { setAuth(JSON.parse(saved)); setStep('permission') } catch { /* ignore */ } }
  }, [quizId])

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

  async function runDeviceCheck() {
    setErr(''); setChecking(true)
    const res = { camera: false, mic: false, screen: false, net: 'ok', netInfo: '' }
    try {
      const r = await recorder.requestMedia()
      res.camera = true; res.mic = true; res.screen = Boolean(r && r.screen)
      mediaReady.current = true
    } catch {
      mediaReady.current = false
    }
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (conn && conn.downlink != null) {
        res.netInfo = `${conn.downlink} Mbps${conn.effectiveType ? ' · ' + conn.effectiveType : ''}`
        res.net = conn.downlink >= 1 ? 'ok' : 'weak'
      } else {
        const t0 = performance.now()
        await fetch(`${window.location.origin}/?cb=${Date.now()}`, { cache: 'no-store' })
        const ms = performance.now() - t0
        res.netInfo = `${Math.round(ms)} ms round-trip`
        res.net = ms < 1500 ? 'ok' : 'weak'
      }
    } catch { res.net = 'weak'; res.netInfo = 'could not reach the server' }
    setCheck(res); setChecking(false)
  }

  async function begin() {
    setErr(''); setBusy(true)
    try {
      if (!mediaReady.current) { await recorder.requestMedia(); mediaReady.current = true }
    } catch {
      setErr('You must allow your camera and microphone to take this exam. Please allow access and try again.')
      setBusy(false); return
    }
    try {
      // Begin live segmented recording and save the storage prefixes to the
      // student row AT ONCE — so even if this attempt crashes mid-exam, the
      // clips already uploaded are discoverable by the teacher.
      const prefixes = recorder.start(auth.student_id)
      if (prefixes && (prefixes.cameraPrefix || prefixes.screenPrefix)) {
        rpc('set_recording_urls', {
          p_student_id: auth.student_id, p_token: auth.token,
          p_camera: prefixes.cameraPrefix, p_screen: prefixes.screenPrefix,
        }).catch(() => {})
      }
      await enterFullscreen()
      const q = await rpc('get_quiz_for_student', { p_student_id: auth.student_id, p_token: auth.token })
      if (q.error) throw new Error(q.error)
      warnCount.current = q.warnings || 0
      const initial = {}
      ;(q.questions || []).forEach((qq) => { if (qq.response != null) initial[qq.id] = qq.response })
      setAnswers(initial); setData(q); setIdx(0); setStep('quiz')
    } catch (e2) { setErr(friendly(e2.message)); setBusy(false) }
    finally { setBusy(false) }
  }

  function setAnswer(qid, val) {
    setAnswers((a) => ({ ...a, [qid]: val }))
    clearTimeout(saveTimers.current[qid])
    saveTimers.current[qid] = setTimeout(() => {
      rpc('save_answer', { p_student_id: auth.student_id, p_token: auth.token, p_question_id: qid, p_response: String(val) }).catch(() => {})
    }, 700)
  }

  async function submit(reason, auto = false) {
    if (step === 'submitting' || step === 'done') return
    if (!auto && !window.confirm('Submit your quiz? You cannot change answers after this.')) return
    setShowReview(false); setStep('submitting')
    let res = null
    try {
      Object.values(saveTimers.current).forEach(clearTimeout)
      await Promise.all(Object.entries(answers).map(([qid, val]) =>
        rpc('save_answer', { p_student_id: auth.student_id, p_token: auth.token, p_question_id: qid, p_response: String(val) }).catch(() => {})
      ))

      // Flush the final recording clip BEFORE locking the attempt. Clips have
      // been uploading live throughout, so this is only the last <=45s — but it
      // must go up while the student is still 'in_progress', because the storage
      // policy only accepts uploads from active attempts. A 12s timeout guard
      // means a slow or hung upload can never block the actual submission.
      setUploadNote('Finishing your recording…')
      try {
        const rec = await Promise.race([
          recorder.stop(),
          new Promise((r) => setTimeout(() => r(null), 12000)),
        ])
        if (rec && rec.cameraUploaded === false) setRecWarn(true)
      } catch (e3) { console.error('recording stop/upload failed', e3) }

      // LOCK + GRADE — the submission is safe even if the upload above failed.
      // The recording prefixes were already saved when the exam started.
      setUploadNote('Submitting your answers…')
      res = await rpc('finish_quiz', { p_student_id: auth.student_id, p_token: auth.token, p_reason: reason })
    } catch (e2) { setErr(friendly(e2.message)) }

    supabase.functions.invoke('send-report-email', { body: { student_id: auth.student_id, token: auth.token } }).catch(() => {})
    sessionStorage.removeItem(`ql_${quizId}`)
    await exitFullscreen()
    setResult(res); setStep('done')
  }

  // =================== RENDER ===================
  if (!isConfigured) return <Center><p>Supabase isn't configured yet. See the README.</p></Center>

  if (step === 'entry') {
    return (
      <Center>
        <form onSubmit={register} className="card" style={{ width: 420, maxWidth: '100%', padding: 28 }}>
          <span style={{ fontWeight: 800, fontSize: 22 }}>QUIZLOCK<span style={{ color: '#d92d28' }}>.</span></span>
          <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 4px' }}>Enter the exam</h1>
          <p className="label" style={{ marginBottom: 22 }}>Your Student ID identifies you — you can take this quiz once.</p>
          <Field id="f-name" label="Full name" v={form.name} on={(v) => setForm({ ...form, name: v })} required />
          <Field id="f-sid" label="Student ID (required)" v={form.student_id} on={(v) => setForm({ ...form, student_id: v })} required />
          <Field id="f-email" label="Email (for your result)" type="email" v={form.email} on={(v) => setForm({ ...form, email: v })} required />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'PLEASE WAIT…' : 'CONTINUE →'}
          </button>
          {err && <p role="alert" style={{ color: '#c72620', marginTop: 14, fontSize: 14 }}>{err}</p>}
        </form>
      </Center>
    )
  }

  if (step === 'permission') {
    return (
      <Center>
        <div className="card" style={{ width: 480, maxWidth: '100%', padding: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 14px' }}>Before you start</h1>
          <ul style={{ fontSize: 16, lineHeight: 1.7, paddingLeft: 20 }}>
            <li>Your <b>camera, microphone and screen</b> will be recorded the whole time.</li>
            <li>The exam opens in <b>fullscreen</b>. Do not switch tabs or leave.</li>
            <li>You get <b>one warning</b>. Leaving again submits your quiz automatically.</li>
            <li>Your answers <b>save automatically</b> — a refresh won't lose them.</li>
          </ul>
          <p style={{ fontFamily: 'inherit', fontSize: 12, color: '#67625a', margin: '14px 0 16px' }}>
            When you run the check, your browser will ask for your camera and to share your screen — choose your <b>entire screen</b>.
          </p>
          <div style={{ border: '1px solid var(--line)', padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="label" style={{ margin: 0, fontWeight: 700 }}>Device check</span>
              <button type="button" className="btn" style={{ padding: '6px 12px' }} disabled={checking} onClick={runDeviceCheck}>
                {checking ? 'CHECKING…' : (check ? 'RE-CHECK' : 'RUN CHECK')}
              </button>
            </div>
            {check && (
              <div style={{ marginTop: 10 }}>
                {recorder.cameraStream && <InlinePreview stream={recorder.cameraStream} />}
                <CheckRow ok={check.camera} label="Camera" bad="Not allowed — allow it in your browser, then re-check" />
                <CheckRow ok={check.mic} label="Microphone" bad="Not allowed" />
                <CheckRow ok={check.screen} warn label="Screen share" bad="Not shared — you'll be asked again at Begin" />
                <CheckRow ok={check.net === 'ok'} warn={check.net === 'weak'} label="Internet" info={check.netInfo} bad="Weak connection — use a stronger network if you can" />
                {!check.camera && <p style={{ color: '#c72620', fontSize: 13, marginTop: 8 }}>Camera + microphone are required. Allow them and re-check.</p>}
              </div>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 18px', cursor: 'pointer', fontSize: 14, lineHeight: 1.4 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I understand and <b>consent</b> to my camera, microphone and screen being recorded during this exam. The recording is private to my teacher.</span>
          </label>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !consent || !check?.camera} onClick={begin}>
            {busy ? 'STARTING…' : (check?.camera ? 'BEGIN EXAM →' : 'RUN DEVICE CHECK FIRST')}
          </button>
          {err && <p role="alert" style={{ color: '#c72620', marginTop: 14, fontSize: 14 }}>{err}</p>}
        </div>
      </Center>
    )
  }

  if (step === 'submitting') return <Center><p style={{ fontFamily: 'inherit' }}>{uploadNote}</p></Center>

  if (step === 'done') {
    const showRes = result?.show_results
    const pct = result && result.total_points ? Math.round((result.score / result.total_points) * 100) : null
    const passed = showRes && result.pass_score != null && pct != null ? pct >= result.pass_score : null
    return (
      <Center>
        <div className="card" style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
          <div style={{ fontSize: 54 }}>✓</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: '8px 0' }}>Quiz submitted</h1>
          {showRes && (
            <div style={{ margin: '10px 0 16px' }}>
              <div style={{ fontFamily: 'inherit', fontSize: 26, fontWeight: 700 }}>
                {result.score} / {result.total_points}{pct != null ? ` · ${pct}%` : ''}
              </div>
              {passed != null && (
                <div style={{ marginTop: 8, display: 'inline-block', padding: '4px 12px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', background: passed ? '#198048' : '#d92d28' }}>
                  {passed ? 'PASSED' : 'DID NOT PASS'}
                </div>
              )}
              <p style={{ fontSize: 12, color: '#67625a', marginTop: 8 }}>Text/code answers may be graded by your teacher later.</p>
            </div>
          )}
          {recWarn ? (
            <p role="alert" style={{ fontSize: 15, lineHeight: 1.6, color: '#c72620', fontWeight: 700 }}>
              ⚠ Your answers were submitted, but your recording could not be uploaded (likely a
              network issue). Please tell your teacher right away, and do not close this tab until
              you have — they may ask you to stay connected a moment longer.
            </p>
          ) : (
            <p style={{ fontSize: 16, lineHeight: 1.6 }}>
              Your recording is being sent to you and your teacher by email. You can close this tab now.
            </p>
          )}
          {err && <p style={{ color: '#67625a', fontSize: 13, marginTop: 12 }}>Note: {err}</p>}
        </div>
      </Center>
    )
  }

  // ---------- the quiz ----------
  const questions = data?.questions || []
  const q = questions[idx]
  const total = questions.length
  const answeredCount = questions.filter((x) => { const v = answers[x.id]; return v != null && String(v).trim() !== '' }).length

  return (
    <div style={{ width: '100%', minHeight: '100%', background: '#f2f1ec', color: '#131311', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 44px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 20 }}>QUIZLOCK<span style={{ color: '#d92d28' }}>.</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <span className="label" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data?.quiz_title}</span>
          {data?.started_at && <Timer startedAt={data.started_at} durationMinutes={data.duration_minutes} onExpire={() => submit('time-up', true)} />}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', padding: '46px 44px', boxSizing: 'border-box', gap: 44, flexWrap: 'wrap' }}>
        <div style={{ width: 560, flexShrink: 0, minWidth: 300 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <span style={{ fontWeight: 700, fontSize: 66, lineHeight: .9, letterSpacing: '-.04em', color: 'var(--muted)' }}>{String(idx + 1).padStart(2, '0')}</span>
            <span style={{ fontFamily: 'inherit', fontSize: 14, color: '#67625a', marginTop: 10, letterSpacing: 1 }}>/ {total}<br />QUESTIONS</span>
          </div>
          <h1 style={{ fontWeight: 600, fontSize: 27, lineHeight: 1.25, margin: '18px 0 0', letterSpacing: '-.01em', maxWidth: 560 }}>{q?.prompt}</h1>
          <div style={{ fontFamily: 'inherit', fontSize: 12, letterSpacing: 1, color: '#67625a', marginTop: 22 }}>
            {q?.type === 'mcq' ? 'SELECT ONE ANSWER' : q?.type === 'truefalse' ? 'TRUE OR FALSE?' : q?.type === 'code' ? 'WRITE YOUR CODE' : 'WRITE YOUR ANSWER'}
          </div>
        </div>

        <div style={{ flex: 1, borderLeft: '1px solid var(--line)', paddingLeft: 44, minWidth: 320 }}>
          {q && <Question q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 40, flexWrap: 'wrap' }}>
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>&larr; BACK</button>
            {idx < total - 1
              ? <button className="btn btn-primary" onClick={() => setIdx(idx + 1)}>NEXT QUESTION &rarr;</button>
              : <button className="btn btn-primary" onClick={() => setShowReview(true)}>REVIEW &amp; SUBMIT ✓</button>}
            <span className="label" style={{ marginLeft: 'auto' }}>{answeredCount}/{total} answered</span>
          </div>
        </div>
      </div>

      <CameraPreview stream={recorder.cameraStream} screen={recorder.hasScreen} />

      {/* Review overlay */}
      {showReview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: 24, overflowY: 'auto' }}>
          <div style={{ background: '#f2f1ec', border: '3px solid #131311', width: 560, maxWidth: '100%', padding: 28, marginTop: 24 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.02em' }}>Review before you submit</h2>
            <p className="label" style={{ marginBottom: 16 }}>{answeredCount} of {total} answered{answeredCount < total ? ` · ${total - answeredCount} still blank` : ''}</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 18 }}>
              {questions.map((x, i) => {
                const done = answers[x.id] != null && String(answers[x.id]).trim() !== ''
                return (
                  <button key={x.id} onClick={() => { setIdx(i); setShowReview(false) }}
                    style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 12, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', background: '#fff', border: '1.5px solid var(--line)' }}>
                    <span style={{ fontFamily: 'inherit', fontWeight: 700, width: 26 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.prompt}</span>
                    <span style={{ fontFamily: 'inherit', fontSize: 11, color: done ? '#198048' : '#d92d28' }}>{done ? 'ANSWERED' : 'BLANK'}</span>
                  </button>
                )
              })}
            </div>
            {answeredCount < total && (
              <p style={{ color: '#c72620', fontSize: 13, marginBottom: 12 }}>You have {total - answeredCount} blank question(s). You can still submit, but they'll score zero.</p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setShowReview(false)}>&larr; KEEP EDITING</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => submit('finished')}>SUBMIT NOW ✓</button>
            </div>
          </div>
        </div>
      )}

      {warnMsg && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 24 }}>
          <div style={{ background: '#f2f1ec', border: '3px solid #d92d28', padding: 36, maxWidth: 460 }}>
            <div className="label" style={{ color: '#d92d28' }}>Warning</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: '10px 0 12px', letterSpacing: '-.02em' }}>Stay on the exam</h2>
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

function InlinePreview({ stream }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream }, [stream])
  return <video ref={ref} autoPlay muted playsInline style={{ width: '100%', maxHeight: 180, objectFit: 'cover', background: '#000', transform: 'scaleX(-1)', marginBottom: 10 }} />
}

function CheckRow({ ok, warn, label, info, bad }) {
  const color = ok ? '#198048' : warn ? '#b8860b' : '#d92d28'
  const icon = ok ? '✓' : warn ? '⚠' : '✗'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', fontSize: 14 }}>
      <span style={{ color, fontWeight: 700, width: 16 }}>{icon}</span>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#67625a', fontSize: 12 }}>{ok ? (info || 'ready') : bad}</span>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</div>
}
function Field({ id, label, v, on, type = 'text', required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field" type={type} required={required} value={v}
        onChange={(e) => on(e.target.value)} style={{ marginTop: 6 }} />
    </div>
  )
}
