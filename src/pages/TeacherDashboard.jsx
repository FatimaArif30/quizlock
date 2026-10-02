import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { LANGS } from '../lib/languages'
import CodeEditor from '../components/CodeEditor'
import Locky from '../components/Locky'

const ALL_TYPES = ['mcq', 'truefalse', 'text', 'code']
const TYPE_LABEL = { mcq: 'MCQ', truefalse: 'TRUE/FALSE', text: 'TEXT', code: 'CODE' }
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// ---- tiny CSV parser (handles quoted fields with commas) ----
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        row.push(field); rows.push(row); row = []; field = ''
      } else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function csvToQuestions(text) {
  const rows = parseCsv(text)
  if (!rows.length) return { ok: [], bad: 0 }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (name) => header.indexOf(name)
  const out = []; let bad = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const get = (n) => { const j = idx(n); return j >= 0 ? (r[j] || '').trim() : '' }
    let type = (get('type') || 'mcq').toLowerCase()
    if (type === 'tf' || type === 'true/false' || type === 'true false') type = 'truefalse'
    const prompt = get('prompt')
    if (!prompt) continue
    if (!ALL_TYPES.includes(type)) { bad++; continue } // skip unknown types instead of failing the batch
    const points = parseInt(get('points'), 10) || 1
    let options = [], correct_key = null, code_lang = null
    if (type === 'mcq') {
      const map = { A: get('option_a'), B: get('option_b'), C: get('option_c'), D: get('option_d') }
      options = Object.entries(map).filter(([, v]) => v).map(([key, text]) => ({ key, text }))
      correct_key = (get('correct') || '').toUpperCase() || null
    } else if (type === 'truefalse') {
      options = [{ key: 'True', text: 'True' }, { key: 'False', text: 'False' }]
      correct_key = (get('correct') || '').trim().toLowerCase().startsWith('t') ? 'True' : 'False'
    } else if (type === 'code') {
      let raw = (get('language') || 'python').toLowerCase().trim()
      if (raw === 'c++') raw = 'cpp'; if (raw === 'bash') raw = 'shell'; if (raw === 'js') raw = 'javascript'
      code_lang = LANGS.some((l) => l.monaco === raw) ? raw : 'python'
    }
    out.push({ type, prompt, options, correct_key, code_lang, points })
  }
  return { ok: out, bad }
}

function WelcomeEmpty({ onCreate }) {
  return (
    <div style={{ minHeight: '68vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px' }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div style={{ position: 'absolute', left: '50%', top: '54%', transform: 'translate(-50%,-50%)', width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(229,50,45,.09), transparent 66%)' }}></div>
        <div style={{ position: 'absolute', top: 2, left: 'calc(50% + 74px)', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '9px 13px', borderRadius: '12px 12px 12px 3px', whiteSpace: 'nowrap', boxShadow: '0 10px 26px rgba(0,0,0,.18)' }}>Hi! I'm Locky — let's make your first quiz.</div>
        <Locky mood="idle" size={168} follow style={{ position: 'relative' }} />
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 8px' }}>Let's make your first quiz</h1>
      <p style={{ fontSize: 14.5, color: 'var(--muted)', lineHeight: 1.55, maxWidth: 400, margin: '0 0 22px' }}>It only takes a minute. You put it together, hand your students one link, and their scores land right here.</p>
      <button className="btn btn-primary" style={{ padding: '13px 26px', fontSize: 15 }} onClick={onCreate}>Make my first quiz</button>
      <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Make it', 'Share the link', 'See who passed'].map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 999, padding: '8px 14px' }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
            <span className="label" style={{ margin: 0 }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const COACH_TIPS = {
  questions: "This is where your questions go. Add them one at a time, or upload a file if you've already written them down.",
  results: "Once your students start, you'll see who's finished, who passed, and their recordings — all right here.",
  roster: "Drop your class list here and only those students can get in. Everyone else stays locked out.",
}
function CoachTip({ id }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem('locky_tip_' + id) === '1' } catch (e) { seen = false }
    setShow(!seen && !!COACH_TIPS[id])
  }, [id])
  if (!show) return null
  function dismiss() { try { localStorage.setItem('locky_tip_' + id, '1') } catch (e) {} setShow(false) }
  return (
    <div style={{ position: 'fixed', right: 22, bottom: 22, zIndex: 90, display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: 380 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '14px 14px 4px 14px', boxShadow: 'var(--shadow)', padding: '13px 15px' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{COACH_TIPS[id]}</div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={dismiss}>Got it</button>
      </div>
      <Locky mood="idle" size={64} />
    </div>
  )
}

export default function TeacherDashboard() {
  const nav = useNavigate()
  const [user, setUser] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [active, setActive] = useState(null)
  const [questions, setQuestions] = useState([])
  const [students, setStudents] = useState([])
  const [assignedIds, setAssignedIds] = useState(new Set())
  const [tab, setTab] = useState('questions')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  function showToast(text, kind = 'ok') {
    setToast({ text, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { nav('/teacher/login'); return }
      setUser(data.session.user)
    })
  }, [nav])

  useEffect(() => { if (user) loadQuizzes() }, [user])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => { reloadData(active, true) }, 8000)
    return () => clearInterval(id)
  }, [active?.id]) // eslint-disable-line

  async function loadQuizzes() {
    const { data } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false })
    setQuizzes(data || [])
  }
  async function reloadData(q, bg = false) {
    if (!bg) setLoading(true)
    const [{ data: qs }, { data: st }] = await Promise.all([
      supabase.from('questions').select('*').eq('quiz_id', q.id).order('created_at'),
      supabase.from('students').select('*').eq('quiz_id', q.id).order('created_at'),
    ])
    setQuestions(qs || []); setStudents(st || [])
    // which questions are already assigned (so we lock them from edit/delete)
    const sids = (st || []).map((s) => s.id)
    if (sids.length) {
      const { data: asg } = await supabase.from('assignments').select('question_id').in('student_id', sids)
      setAssignedIds(new Set((asg || []).map((a) => a.question_id)))
    } else setAssignedIds(new Set())
    if (!bg) setLoading(false)
  }
  async function openQuiz(q) { setCreating(false); setActive(q); setTab('questions'); await reloadData(q) }
  async function refreshActive() { if (active) await reloadData(active) }
  async function logout() { await supabase.auth.signOut(); nav('/teacher/login') }

  if (!user) return null

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Teacher dashboard</h1>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', borderBottom: '1px solid var(--line)', background: 'var(--card)', position: 'sticky', top: 0, zIndex: 5 }}>
        <span style={{ fontWeight: 800, fontSize: 20 }}>QUIZLOCK<span style={{ color: '#d92d28' }}>.</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="label">{user.email}</span>
          <button className="btn" onClick={logout} style={{ padding: '10px 16px' }}>LOG OUT</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 288, borderRight: '1px solid var(--line)', padding: 18, overflowY: 'auto', background: 'var(--card)' }}>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setCreating(true); setActive(null) }}>+ New quiz</button>
          <div className="label" style={{ margin: '22px 0 10px' }}>Your quizzes</div>
          {quizzes.map((q) => (
            <button key={q.id} onClick={() => openQuiz(q)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', marginBottom: 6, cursor: 'pointer', borderRadius: 10,
                       border: active?.id === q.id ? '1px solid var(--ink)' : '1px solid var(--line)', background: active?.id === q.id ? 'var(--ink)' : 'var(--card)', color: active?.id === q.id ? '#fff' : 'var(--ink)' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{q.title}</div>
              <div style={{ fontSize: 11.5, opacity: .7, marginTop: 2 }}>
                {q.num_students} students · {q.unique_questions ? `${q.questions_per_student} each` : 'same set'}
              </div>
            </button>
          ))}
          {!quizzes.length && <p style={{ fontSize: 13, color: '#67625a' }}>No quizzes yet — create one above.</p>}
        </div>

        <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
          {!active && (quizzes.length === 0
            ? <WelcomeEmpty onCreate={() => { setCreating(true); setActive(null) }} />
            : <p style={{ color: 'var(--muted)' }}>Pick a quiz on the left, or start a new one.</p>)}
          {active && loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
          {active && !loading && (
            <QuizPanel
              quiz={active} questions={questions} students={students} assignedIds={assignedIds}
              tab={tab} setTab={setTab} toast={showToast} onChange={refreshActive}
              onQuizChange={(q) => { setActive(q); loadQuizzes() }}
              onDeleted={() => { setActive(null); loadQuizzes() }}
            />
          )}
        </div>
      </div>

      {creating && (
        <CreateWizard teacherId={user.id} toast={showToast}
          onCancel={() => setCreating(false)}
          onCreated={async (q) => { setCreating(false); await loadQuizzes(); if (q) openQuiz(q); showToast('Quiz created') }} />
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  )
}

// ---------- Quiz settings form (shared by New + Edit) ----------
function QuizForm({ initial, submitLabel, onSubmit, onCancel, wide }) {
  const [title, setTitle] = useState(initial.title || '')
  const [nStu, setNStu] = useState(initial.num_students ?? 10)
  const [perStu, setPerStu] = useState(initial.questions_per_student ?? 10)
  const [uniqueQ, setUniqueQ] = useState(initial.unique_questions ?? false)
  const [dur, setDur] = useState(initial.duration_minutes ?? 30)
  const [types, setTypes] = useState({ mcq: true, truefalse: true, text: true, code: true, ...(initial.typesMap || {}) })
  const [openAt, setOpenAt] = useState(toLocalInput(initial.opens_at))
  const [closeAt, setCloseAt] = useState(toLocalInput(initial.closes_at))
  const [typePts, setTypePts] = useState({ mcq: 1, truefalse: 1, text: 2, code: 5, ...(initial.type_points || {}) })
  const [passOn, setPassOn] = useState(initial.pass_score != null)
  const [passScore, setPassScore] = useState(initial.pass_score ?? 50)
  const [showResults, setShowResults] = useState(!!initial.show_results)
  const needed = (parseInt(nStu) || 0) * (parseInt(perStu) || 0)
  const chosen = ALL_TYPES.filter((t) => types[t])

  function submit() {
    if (!title.trim()) return
    if (!chosen.length) return
    onSubmit({
      title: title.trim(), num_students: parseInt(nStu) || 1,
      questions_per_student: parseInt(perStu) || 1, duration_minutes: parseInt(dur) || 30,
      unique_questions: uniqueQ,
      allowed_types: chosen, pass_score: passOn ? (parseInt(passScore) || 0) : null,
      show_results: showResults,
      opens_at: openAt ? new Date(openAt).toISOString() : null,
      closes_at: closeAt ? new Date(closeAt).toISOString() : null,
      type_points: Object.fromEntries(chosen.map((t) => [t, parseInt(typePts[t]) || 1])),
    })
  }

  // plain helper (NOT a component) so inputs keep focus across renders
  const card = (ix, ctitle, body, sub) => (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{ix}</span>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>{ctitle}</h3>
        {sub ? <span className="label" style={{ margin: 0, marginLeft: 'auto', color: 'var(--muted)' }}>{sub}</span> : null}
      </div>
      <div style={{ padding: '16px 18px' }}>{body}</div>
    </div>
  )

  const basics = card(1, 'Basics', (
    <>
      <label className="label">Quiz title</label>
      <input className="field" placeholder="e.g. Data Structures — Final Exam" value={title} onChange={(e) => setTitle(e.target.value)} style={{ margin: '4px 0 14px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: uniqueQ ? '1fr 1fr 1fr' : '1fr 1fr', gap: 14 }}>
        <div>
          <label className="label">How many students?</label>
          <input className="field" type="number" aria-label="Number of students" min={1} value={nStu} onChange={(e) => setNStu(e.target.value)} style={{ marginTop: 4 }} />
        </div>
        {uniqueQ && (
          <div>
            <label className="label">Questions per student</label>
            <input className="field" type="number" aria-label="Questions per student" min={1} value={perStu} onChange={(e) => setPerStu(e.target.value)} style={{ marginTop: 4 }} />
          </div>
        )}
        <div>
          <label className="label">Time limit (min)</label>
          <input className="field" type="number" aria-label="Time limit in minutes" min={1} value={dur} onChange={(e) => setDur(e.target.value)} style={{ marginTop: 4 }} />
        </div>
      </div>
    </>
  ))

  const typesCard = card(2, 'Question types & points', (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: chosen.length ? 14 : 0 }}>
        {ALL_TYPES.map((t) => (
          <button type="button" key={t} onClick={() => setTypes({ ...types, [t]: !types[t] })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: types[t] ? '1px solid var(--ink)' : '1px solid var(--line)', background: types[t] ? 'var(--ink)' : '#fcfbf8', color: types[t] ? '#fff' : 'var(--ink-2)', borderRadius: 999, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
            {TYPE_LABEL[t]} {types[t] ? '✓' : ''}
          </button>
        ))}
      </div>
      {chosen.length > 0 && (
        <>
          <label className="label" style={{ marginBottom: 2 }}>Default marks per type (editable per question later)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 8 }}>
            {chosen.map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="label" style={{ margin: 0, width: 92 }}>{TYPE_LABEL[t]}</span>
                <input className="field" type="number" aria-label="Marks for this question type" min={1} value={typePts[t] ?? 1} onChange={(e) => setTypePts({ ...typePts, [t]: e.target.value })} style={{ width: 80 }} />
                <span className="label" style={{ margin: 0 }}>marks</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  ))

  const windowCard = card(3, 'Availability window', (
    <div style={{ display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', gap: 14 }}>
      <div>
        <label className="label">Opens at</label>
        <input className="field" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} style={{ marginTop: 4, width: '100%', fontFamily: 'inherit', fontSize: 14, height: 46, colorScheme: 'light' }} />
      </div>
      <div>
        <label className="label">Closes at</label>
        <input className="field" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} style={{ marginTop: 4, width: '100%', fontFamily: 'inherit', fontSize: 14, height: 46, colorScheme: 'light' }} />
      </div>
    </div>
  ), 'optional')

  const distCard = card(4, 'Question distribution', (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[['same', 'Same for everyone', 'Everyone sees the same set of questions.'],
          ['unique', 'Unique per student', 'Each student gets their own random mix.']].map(([val, t, d]) => {
          const on = (val === 'unique') === uniqueQ
          return (
            <button type="button" key={val} onClick={() => setUniqueQ(val === 'unique')}
              style={{ flex: '1 1 150px', textAlign: 'left', border: on ? '1px solid var(--ink)' : '1px solid var(--line)', boxShadow: on ? '0 0 0 1px var(--ink) inset' : 'none', background: on ? '#fff' : '#fcfbf8', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{d}</div>
            </button>
          )
        })}
      </div>
      <div style={{ background: 'var(--ink)', color: '#f2f1ec', padding: '10px 12px', borderRadius: 10, fontSize: 12, marginTop: 12 }}>
        {uniqueQ
          ? <>You'll need <b style={{ color: '#f0645f' }}>{needed}</b> questions total (unique sets).</>
          : <>Add as many questions as you like — every student gets all of them.</>}
      </div>
    </>
  ))

  const resultsCard = card(5, 'Results & passing', (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={passOn} onChange={(e) => setPassOn(e.target.checked)} />
        <span className="label" style={{ margin: 0 }}>Set a passing score</span>
      </label>
      {passOn && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0' }}>
          <span className="label" style={{ margin: 0 }}>Pass at</span>
          <input className="field" type="number" aria-label="Pass score, percent" min={0} max={100} value={passScore} onChange={(e) => setPassScore(e.target.value)} style={{ width: 90 }} />
          <span className="label" style={{ margin: 0 }}>%</span>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 14 }}>
        <input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} />
        <span className="label" style={{ margin: 0 }}>Show students their result after submit</span>
      </label>
    </>
  ))

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 2px', marginTop: 4 }}>
      <span className="label" style={{ margin: 0, color: 'var(--muted)' }}>You'll add questions after creating.</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" onClick={onCancel} style={{ padding: '10px 18px' }}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} style={{ padding: '10px 20px' }}>{submitLabel}</button>
      </div>
    </div>
  )

  if (wide) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 4px' }}>Create a quiz</h1>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>Set the rules now — you'll add questions in the next step.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button className="btn" onClick={onCancel} style={{ padding: '10px 18px' }}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} style={{ padding: '10px 20px' }}>{submitLabel}</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{basics}{typesCard}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{windowCard}{distCard}{resultsCard}</div>
        </div>
        {footer}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {basics}{typesCard}{windowCard}{distCard}{resultsCard}{footer}
    </div>
  )
}

// ---------- Create Quiz WIZARD (full-screen, live preview) ----------
const WLABEL = { mcq: 'Multiple choice', truefalse: 'True / False', text: 'Short answer', code: 'Code' }

function CreateWizard({ teacherId, onCancel, onCreated, toast }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [dur, setDur] = useState(60)
  const [types, setTypes] = useState({ mcq: true, truefalse: true, text: false, code: false })
  const [dist, setDist] = useState('same')
  const [nStu, setNStu] = useState(30)
  const [perStu, setPerStu] = useState(10)
  const [schedule, setSchedule] = useState(false)
  const [openAt, setOpenAt] = useState('')
  const [closeAt, setCloseAt] = useState('')
  const [passOn, setPassOn] = useState(true)
  const [passScore, setPassScore] = useState(50)
  const [showResults, setShowResults] = useState(false)

  const chosen = ALL_TYPES.filter((t) => types[t])

  async function doCreate() {
    if (!title.trim()) { setStep(0); return }
    if (!chosen.length) { setStep(1); toast('Pick at least one kind of question.', 'err'); return }
    const DEFP = { mcq: 1, truefalse: 1, text: 2, code: 5 }
    const vals = {
      title: title.trim(),
      num_students: dist === 'unique' ? (parseInt(nStu) || 1) : 30,
      questions_per_student: dist === 'unique' ? (parseInt(perStu) || 10) : 10,
      duration_minutes: parseInt(dur) || 30,
      unique_questions: dist === 'unique',
      allowed_types: chosen,
      pass_score: passOn ? (parseInt(passScore) || 0) : null,
      show_results: showResults,
      opens_at: schedule && openAt ? new Date(openAt).toISOString() : null,
      closes_at: schedule && closeAt ? new Date(closeAt).toISOString() : null,
      type_points: Object.fromEntries(chosen.map((t) => [t, DEFP[t] || 1])),
    }
    setBusy(true)
    const { data, error } = await supabase.from('quizzes').insert({ teacher_id: teacherId, ...vals }).select().single()
    setBusy(false)
    if (error) { toast(error.message, 'err'); return }
    setCreated(data)
    setStep(3)
  }
  const [created, setCreated] = useState(null)

  function next() {
    if (step === 0 && !title.trim()) return
    if (step === 2) { doCreate(); return }
    if (step === 3) { onCreated(created); return }
    setStep(Math.min(3, step + 1))
  }

  const tick = (i) => (step >= 3 ? 'done' : i < step ? 'done' : i === step ? 'active' : '')

  return (
    <div className="cw-root">
      <style>{`
        .cw-root{position:fixed;inset:0;z-index:120;background:var(--bg);display:grid;grid-template-columns:1fr 0.8fr;animation:cwIn .22s ease}
        @keyframes cwIn{from{opacity:0}to{opacity:1}}
        .cw-left{display:flex;flex-direction:column;padding:26px clamp(22px,4vw,56px) 26px;overflow-y:auto}
        .cw-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
        .cw-cancel{background:none;border:0;font-family:inherit;font-size:13px;color:var(--muted);cursor:pointer;font-weight:500}
        .cw-cancel:hover{color:var(--ink)}
        .cw-ticks{display:flex;gap:7px;max-width:220px;margin-bottom:26px}
        .cw-tk{height:4px;flex:1;border-radius:999px;background:var(--track);transition:.35s}
        .cw-tk.done{background:var(--ink)}.cw-tk.active{background:var(--accent)}
        .cw-body{flex:1;max-width:460px}
        .cw-sn{font-size:12px;color:var(--muted);margin-bottom:10px;font-weight:600}
        .cw-h{font-size:clamp(22px,2.6vw,29px);font-weight:800;letter-spacing:-.02em;line-height:1.18;margin:0 0 9px}
        .cw-h em{font-style:normal;color:var(--accent)}
        .cw-sub{font-size:14px;color:var(--muted);line-height:1.55;margin:0 0 24px}
        .cw-chips{display:flex;gap:9px;flex-wrap:wrap}
        .cw-chip{border:1px solid var(--line);background:#fcfbf8;border-radius:999px;padding:9px 15px;font-size:13px;font-weight:600;color:var(--ink-2);cursor:pointer}
        .cw-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
        .cw-seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fcfbf8}
        .cw-seg button{flex:1;border:0;background:transparent;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2);padding:11px 10px;cursor:pointer}
        .cw-seg button.on{background:var(--ink);color:#fff}
        .cw-opt{display:flex;align-items:flex-start;gap:12px;border:1px solid var(--line);border-radius:10px;padding:13px 14px;margin-bottom:12px;background:#fcfbf8;cursor:pointer}
        .cw-sw{width:38px;height:22px;border-radius:999px;background:var(--track);position:relative;flex:none;transition:.15s;margin-top:1px}
        .cw-sw:after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:.15s}
        .cw-opt.on .cw-sw{background:var(--accent)}.cw-opt.on .cw-sw:after{left:18px}
        .cw-nav{display:flex;align-items:center;gap:12px;margin-top:26px}
        .cw-nav .sp{flex:1}
        .cw-right{position:relative;overflow:hidden;background:var(--ink);display:flex;align-items:center;justify-content:center;padding:36px}
        .cw-right:before{content:"";position:absolute;inset:0;background:radial-gradient(520px 360px at 72% 18%,rgba(229,50,45,.22),transparent 60%),radial-gradient(460px 420px at 20% 95%,rgba(229,50,45,.10),transparent 60%)}
        .cw-dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.055) 1.1px,transparent 1.1px);background-size:22px 22px;-webkit-mask-image:linear-gradient(to bottom,#000,transparent 86%);mask-image:linear-gradient(to bottom,#000,transparent 86%)}
        .cw-plabel{position:absolute;top:24px;left:28px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.4);font-weight:600}
        .cw-stage{position:relative;width:100%;max-width:360px}
        .cw-card{background:#fff;border-radius:18px;box-shadow:0 30px 60px rgba(0,0,0,.4);padding:22px;transition:.3s}
        .cw-ct{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        .cw-title{font-size:19px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
        .cw-title.e{color:#c9c6bd}
        .cw-time{flex:none;background:var(--accent);color:#fff;font-weight:700;font-size:12px;padding:5px 11px;border-radius:999px;white-space:nowrap}
        .cw-by{font-size:12px;color:var(--muted);margin-top:4px}
        .cw-div{height:1px;background:var(--line);margin:15px 0}
        .cw-sl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:9px}
        .cw-tp{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
        .cw-tpc{font-size:11px;font-weight:600;background:#f1efe8;color:var(--ink-2);border-radius:999px;padding:4px 10px}
        .cw-q{border:1px solid var(--line);border-radius:10px;padding:11px 12px}
        .cw-qn{font-size:12.5px;font-weight:700;margin-bottom:8px}
        .cw-o{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-2);padding:3px 0}
        .cw-bub{width:13px;height:13px;border-radius:50%;border:1.5px solid var(--line)}
        .cw-bub.s{border-color:var(--accent);background:radial-gradient(circle,var(--accent) 42%,transparent 46%)}
        .cw-rl{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2);margin-top:7px}
        .cw-rl .ic{color:var(--accent);font-weight:800}
        .cw-share{display:flex;align-items:center;gap:8px;background:#f7f6f1;border:1px dashed var(--line);border-radius:9px;padding:9px 11px;font-size:11.5px;color:var(--muted);margin-top:10px}
        .cw-share b{color:var(--ink)}
        .cw-float{position:absolute;background:#fff;border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.35);padding:10px 13px;display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600}
        .cw-float.a{right:-14px;top:-22px}
        .cw-float.a .av{width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
        .cw-float.b{left:-18px;bottom:-16px;color:var(--good)}
        .cw-float.b .cc{width:22px;height:22px;border-radius:50%;background:var(--good);color:#fff;display:grid;place-items:center;font-weight:800}
        @media(max-width:880px){.cw-root{grid-template-columns:1fr}.cw-right{display:none}}
      `}</style>

      <div className="cw-left">
        <div className="cw-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--ink)', position: 'relative', display: 'inline-block' }}><span style={{ position: 'absolute', inset: 6, borderRadius: 3, background: 'var(--accent)' }}></span></span>
            <span style={{ fontWeight: 800, fontSize: 15 }}>QuizLock</span>
          </div>
          <button className="cw-cancel" onClick={onCancel}>✕ Cancel</button>
        </div>

        <div className="cw-ticks">
          <div className={`cw-tk ${tick(0)}`}></div><div className={`cw-tk ${tick(1)}`}></div><div className={`cw-tk ${tick(2)}`}></div>
        </div>

        <div className="cw-body">
          {step === 0 && (<>
            <div className="cw-sn">Step 1 of 3</div>
            <h1 className="cw-h">Let's set up your <em>quiz</em>.</h1>
            <p className="cw-sub">Give it a name and decide how long students get. You can change any of this later.</p>
            <div style={{ marginBottom: 20 }}>
              <label className="label">Quiz name</label>
              <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data Structures — Midterm" style={{ marginTop: 6 }} />
            </div>
            <div style={{ maxWidth: 200 }}>
              <label className="label">Time limit (minutes)</label>
              <input className="field" type="number" aria-label="Time limit in minutes" min={1} value={dur} onChange={(e) => setDur(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </>)}

          {step === 1 && (<>
            <div className="cw-sn">Step 2 of 3</div>
            <h1 className="cw-h">What kind of <em>questions</em>?</h1>
            <p className="cw-sub">Pick the question types this quiz can include. You'll write the actual questions next.</p>
            <div className="cw-chips" style={{ marginBottom: 22 }}>
              {ALL_TYPES.map((t) => (
                <button key={t} className={`cw-chip ${types[t] ? 'on' : ''}`} onClick={() => setTypes({ ...types, [t]: !types[t] })}>{WLABEL[t]} {types[t] ? '✓' : ''}</button>
              ))}
            </div>
            <label className="label">How should questions be given out?</label>
            <div className="cw-seg" style={{ margin: '6px 0 8px' }}>
              <button className={dist === 'same' ? 'on' : ''} onClick={() => setDist('same')}>Same for everyone</button>
              <button className={dist === 'unique' ? 'on' : ''} onClick={() => setDist('unique')}>A unique set per student</button>
            </div>
            <p className="cw-sub" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
              {dist === 'unique' ? 'Each student gets a random set — add a bigger pool of questions.' : 'Everyone sees the same questions (order is shuffled per student).'}
            </p>
            {dist === 'unique' && (
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ flex: 1 }}><label className="label">How many students?</label><input className="field" type="number" aria-label="Number of students" min={1} value={nStu} onChange={(e) => setNStu(e.target.value)} style={{ marginTop: 6 }} /></div>
                <div style={{ flex: 1 }}><label className="label">Questions per student</label><input className="field" type="number" aria-label="Questions per student" min={1} value={perStu} onChange={(e) => setPerStu(e.target.value)} style={{ marginTop: 6 }} /></div>
              </div>
            )}
          </>)}

          {step === 2 && (<>
            <div className="cw-sn">Step 3 of 3 · all optional</div>
            <h1 className="cw-h">Any extra <em>rules</em>?</h1>
            <p className="cw-sub">Most teachers skip this and use the defaults. Turn on only what you need.</p>
            <div className={`cw-opt ${passOn ? 'on' : ''}`} onClick={() => setPassOn(!passOn)}>
              <div className="cw-sw"></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Set a passing mark</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Mark students pass or fail.</div>
                {passOn && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <span className="label" style={{ margin: 0 }}>Pass at</span>
                    <input className="field" type="number" aria-label="Pass score, percent" min={0} max={100} value={passScore} onChange={(e) => setPassScore(e.target.value)} style={{ width: 80 }} />
                    <span className="label" style={{ margin: 0 }}>%</span>
                  </div>
                )}
              </div>
            </div>
            <div className={`cw-opt ${showResults ? 'on' : ''}`} onClick={() => setShowResults(!showResults)}>
              <div className="cw-sw"></div>
              <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>Show students their score</div><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Right after they submit.</div></div>
            </div>
            <div className={`cw-opt ${schedule ? 'on' : ''}`} onClick={() => setSchedule(!schedule)}>
              <div className="cw-sw"></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Open only at a set time</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Pick a start and end window.</div>
                {schedule && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ flex: 1 }}><label className="label">Opens</label><input className="field" type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} style={{ marginTop: 4, width: '100%', fontFamily: 'inherit', fontSize: 14, height: 46, colorScheme: 'light' }} /></div>
                    <div style={{ flex: 1 }}><label className="label">Closes</label><input className="field" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} style={{ marginTop: 4, width: '100%', fontFamily: 'inherit', fontSize: 14, height: 46, colorScheme: 'light' }} /></div>
                  </div>
                )}
              </div>
            </div>
          </>)}

          {step === 3 && (<>
            <div className="cw-sn">&nbsp;</div>
            <h1 className="cw-h">Your quiz is <em>ready</em>.</h1>
            <p className="cw-sub">Next, add your questions — then share the link with your students. That's it.</p>
          </>)}

          <div className="cw-nav">
            {step > 0 && step < 3 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>← Back</button>}
            {step === 2 && <button className="btn btn-ghost" onClick={doCreate} disabled={busy}>Skip, use defaults</button>}
            <div className="sp"></div>
            <button className="btn btn-primary" onClick={next} disabled={busy}>
              {busy ? 'Creating…' : step === 2 ? 'Create quiz →' : step === 3 ? 'Add questions →' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>

      <aside className="cw-right">
        <div className="cw-dots"></div>
        <div className="cw-plabel">{step >= 3 ? 'Created ✓' : 'Live preview'}</div>
        <div className="cw-stage">
          <div className="cw-card">
            <div className="cw-ct">
              <div>
                <div className={`cw-title ${title.trim() ? '' : 'e'}`}>{title.trim() || 'Untitled quiz'}</div>
                <div className="cw-by">by you</div>
              </div>
              <div className="cw-time">{(parseInt(dur) || 0)} min</div>
            </div>

            {step >= 1 && (<>
              <div className="cw-div"></div>
              <div className="cw-sl">Questions</div>
              <div className="cw-tp">
                {chosen.length ? chosen.map((t) => <span key={t} className="cw-tpc">{WLABEL[t]}</span>) : <span className="cw-tpc" style={{ color: '#c9c6bd' }}>pick a type…</span>}
              </div>
              <div className="cw-q">
                <div className="cw-qn">1. Which structure uses FIFO order?</div>
                <div className="cw-o"><span className="cw-bub"></span>Stack</div>
                <div className="cw-o"><span className="cw-bub s"></span>Queue</div>
                <div className="cw-o"><span className="cw-bub"></span>Tree</div>
              </div>
              <div className="cw-rl" style={{ color: 'var(--muted)', fontSize: 11.5 }}>{dist === 'unique' ? '⤭ Each student gets a different set' : '⇉ Same questions for everyone'}</div>
            </>)}

            {step >= 2 && (<>
              <div className="cw-div"></div>
              <div className="cw-sl">Rules</div>
              {passOn && <div className="cw-rl"><span className="ic">✓</span>Passing mark: {parseInt(passScore) || 0}%</div>}
              {showResults && <div className="cw-rl"><span className="ic">✓</span>Students see their score on submit</div>}
              {schedule && <div className="cw-rl"><span className="ic">✓</span>Opens at a scheduled time</div>}
              {!passOn && !showResults && !schedule && <div className="cw-rl" style={{ color: 'var(--muted)' }}>Using the defaults</div>}
            </>)}

            {step >= 3 && (
              <div className="cw-share"><span>🔗</span><b>quizlock.app/go/8F2K</b><span style={{ marginLeft: 'auto' }}>Share</span></div>
            )}
          </div>

          <div className="cw-float a"><span className="av">{dist === 'unique' ? (parseInt(nStu) || 0) : '∞'}</span>{dist === 'unique' ? 'students' : 'open to all'}</div>
          {step >= 3 && <div className="cw-float b"><span className="cc">✓</span>Ready to share</div>}
        </div>
      </aside>
    </div>
  )
}

// ---------- Edit quiz DETAILS drawer (slide-over) ----------
function EditDrawer({ quiz, onClose, onSaved, toast }) {
  const allowedTypes = (quiz.allowed_types && quiz.allowed_types.length) ? quiz.allowed_types : ALL_TYPES
  const typesMap = Object.fromEntries(ALL_TYPES.map((t) => [t, allowedTypes.includes(t)]))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line
  return (
    <div className="ed-root" onClick={onClose}>
      <style>{`
        .ed-root{position:fixed;inset:0;z-index:110;background:rgba(19,19,17,.5);display:flex;justify-content:flex-end;animation:edFade .2s ease}
        @keyframes edFade{from{opacity:0}to{opacity:1}}
        .ed-panel{width:560px;max-width:94vw;height:100%;background:var(--bg);box-shadow:-20px 0 50px rgba(0,0,0,.25);display:flex;flex-direction:column;animation:edSlide .26s cubic-bezier(.2,.8,.2,1)}
        @keyframes edSlide{from{transform:translateX(40px);opacity:.6}to{transform:none;opacity:1}}
        .ed-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 24px;border-bottom:1px solid var(--line);background:var(--card)}
        .ed-head h2{margin:0;font-size:18px;font-weight:800;letter-spacing:-.02em}
        .ed-head p{margin:3px 0 0;font-size:12.5px;color:var(--muted)}
        .ed-x{background:none;border:0;font-size:18px;color:var(--muted);cursor:pointer;line-height:1}
        .ed-body{flex:1;overflow-y:auto;padding:22px 24px}
      `}</style>
      <div className="ed-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <div><h2>Quiz settings</h2><p>{quiz.title}</p></div>
          <button className="ed-x" onClick={onClose}>✕</button>
        </div>
        <div className="ed-body">
          <QuizForm initial={{ ...quiz, typesMap }} submitLabel="Save changes" onCancel={onClose}
            onSubmit={async (vals) => {
              const { data, error } = await supabase.from('quizzes').update(vals).eq('id', quiz.id).select().single()
              if (error) { toast(error.message, 'err'); return }
              onSaved(data)
            }} />
        </div>
      </div>
    </div>
  )
}

function NewQuiz({ onCreated, teacherId, toast }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setOpen(true)}>+ NEW QUIZ</button>
  return (
    <QuizForm initial={{}} submitLabel="CREATE" onCancel={() => setOpen(false)}
      onSubmit={async (vals) => {
        const { error } = await supabase.from('quizzes').insert({ teacher_id: teacherId, ...vals })
        if (error) { toast(error.message, 'err'); return }
        setOpen(false); onCreated(); toast('Quiz created')
      }} />
  )
}

// ---------- Quiz panel ----------
function QuizPanel({ quiz, questions, students, assignedIds, tab, setTab, toast, onChange, onQuizChange, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const link = `${window.location.origin}/quiz/${quiz.id}`
  const needed = quiz.num_students * quiz.questions_per_student
  const allowedTypes = (quiz.allowed_types && quiz.allowed_types.length) ? quiz.allowed_types : ALL_TYPES

  async function toggleOpen() {
    const { data } = await supabase.from('quizzes').update({ is_open: !quiz.is_open }).eq('id', quiz.id).select().single()
    if (data) { onQuizChange(data); toast(data.is_open ? 'Quiz opened' : 'Quiz closed') }
  }
  async function copyLink() { await navigator.clipboard.writeText(link); toast('Link copied ✓') }
  async function del() {
    if (!window.confirm(`Delete "${quiz.title}"? This removes its questions, students, attempts and recordings. This cannot be undone.`)) return
    // remove recording files from storage first so they aren't orphaned.
    // A stored value is either a legacy single file or a segment-folder prefix;
    // expand prefixes into their clip paths before deleting.
    const { data: sts } = await supabase.from('students').select('camera_url,screen_url').eq('quiz_id', quiz.id)
    const stored = (sts || []).flatMap((s) => [s.camera_url, s.screen_url]).filter(Boolean)
    const paths = []
    for (const v of stored) {
      if (/\.webm$/i.test(v)) { paths.push(v); continue }
      try {
        const { data: files } = await supabase.storage.from('recordings').list(v, { limit: 1000 })
        ;(files || []).forEach((f) => paths.push(`${v}/${f.name}`))
      } catch { /* ignore */ }
    }
    if (paths.length) { try { await supabase.storage.from('recordings').remove(paths) } catch { /* ignore */ } }
    const { error } = await supabase.from('quizzes').delete().eq('id', quiz.id)
    if (error) { toast(error.message, 'err'); return }
    toast('Quiz deleted'); onDeleted()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>{quiz.title}</h1>
          <div className="label">
            {quiz.num_students} students · {quiz.unique_questions ? `${quiz.questions_per_student} each` : 'same set'} · {quiz.duration_minutes} min · {allowedTypes.map((t) => TYPE_LABEL[t] || t.toUpperCase()).join(', ')}
            {quiz.pass_score != null ? ` · pass ${quiz.pass_score}%` : ''}{quiz.show_results ? ' · results shown' : ''}
            {(quiz.opens_at || quiz.closes_at) ? ' · scheduled' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setEditing(true)}>Edit details</button>
          <button className="btn" onClick={toggleOpen}
            style={{ background: quiz.is_open ? '#198048' : '#fff', color: quiz.is_open ? '#fff' : '#131311', borderColor: quiz.is_open ? '#198048' : '#131311' }}>
            {quiz.is_open ? 'OPEN ✓' : 'CLOSED'}
          </button>
          <button className="btn" onClick={del} style={{ color: '#d92d28', borderColor: '#d92d28' }}>DELETE</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '20px 0', flexWrap: 'wrap' }}>
        <code style={{ background: '#fff', border: '1px solid var(--line)', padding: '12px 14px', fontFamily: 'inherit', fontSize: 13 }}>{link}</code>
        <button className="btn" onClick={copyLink} style={{ padding: '12px 16px' }}>COPY LINK</button>
      </div>

      <div style={{ display: 'inline-flex', gap: 4, background: '#f1f0ea', padding: 4, borderRadius: 10, marginBottom: 24 }}>
        {['questions', 'results', 'roster'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, borderRadius: 7,
                     background: tab === t ? 'var(--ink)' : 'transparent', color: tab === t ? '#fff' : 'var(--muted)' }}>
            {t === 'questions' ? `Questions (${questions.length}${quiz.unique_questions ? '/' + needed : ''})` : t === 'results' ? `Results (${students.length})` : 'Roster'}
          </button>
        ))}
      </div>

      {tab === 'questions'
        ? <QuestionsTab quiz={quiz} questions={questions} needed={needed} allowedTypes={allowedTypes} assignedIds={assignedIds} toast={toast} onChange={onChange} />
        : tab === 'results'
        ? <ResultsTab quiz={quiz} students={students} questions={questions} toast={toast} onChange={onChange} onQuizChange={onQuizChange} />
        : <RosterTab quiz={quiz} toast={toast} />}
      {editing && <EditDrawer quiz={quiz} toast={toast} onClose={() => setEditing(false)} onSaved={(data) => { setEditing(false); onQuizChange(data); toast('Quiz updated') }} />}
      <CoachTip id={tab} />
    </div>
  )
}

// ---------- Questions tab ----------
function QuestionsTab({ quiz, questions, needed, allowedTypes, assignedIds, toast, onChange }) {
  const enough = quiz.unique_questions ? (questions.length >= needed) : (questions.length >= 1)
  const [menuId, setMenuId] = useState(null)
  const [editing, setEditing] = useState(null)

  async function del(q) {
    if (assignedIds.has(q.id)) { toast('This question is in use by a student and is locked.', 'err'); return }
    if (!window.confirm('Delete this question?')) return
    await supabase.from('questions').delete().eq('id', q.id); setMenuId(null); onChange(); toast('Question deleted')
  }
  async function duplicate(q) {
    const { error } = await supabase.from('questions').insert({
      quiz_id: q.quiz_id, type: q.type, prompt: `${q.prompt} (copy)`,
      options: q.options || [], correct_key: q.correct_key, points: q.points,
    })
    setMenuId(null); if (error) { toast(error.message, 'err'); return }
    onChange(); toast('Question duplicated')
  }

  return (
    <div>
      <div style={{ background: enough ? '#e6f6ee' : '#fdf0ef', border: `2px solid ${enough ? '#198048' : '#d92d28'}`, padding: 14, marginBottom: 22, fontFamily: 'inherit', fontSize: 13 }}>
        {quiz.unique_questions
          ? (enough
              ? `✓ Enough questions. Every student gets a unique set of ${quiz.questions_per_student}.`
              : `Add ${needed - questions.length} more question(s). You need ${needed} for unique sets.`)
          : (enough
              ? `✓ Every student gets all ${questions.length} question(s) you've added.`
              : `Add at least 1 question — every student gets all of them.`)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30, alignItems: 'start' }}>
        <AddQuestion quizId={quiz.id} allowedTypes={allowedTypes} typePoints={quiz.type_points || {}} toast={toast} onChange={onChange} />
        <BulkAdd quizId={quiz.id} allowedTypes={allowedTypes} toast={toast} onChange={onChange} />
      </div>

      <div className="label" style={{ margin: '30px 0 12px' }}>Questions ({questions.length}) · locked ones are in use by a student</div>
      {questions.map((q, i) => {
        const locked = assignedIds.has(q.id)
        return (
          <div key={q.id} style={{ border: '1px solid var(--line)', padding: 16, marginBottom: 10, background: '#fff', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <span style={{ fontFamily: 'inherit', fontSize: 11, background: '#131311', color: '#fff', padding: '2px 7px', marginRight: 8 }}>{TYPE_LABEL[q.type] || q.type.toUpperCase()}</span>
              {locked && <span style={{ fontFamily: 'inherit', fontSize: 11, background: '#9c5d17', color: '#fff', padding: '2px 7px', marginRight: 8 }}>LOCKED</span>}
              <span style={{ fontWeight: 600 }}>{i + 1}. {q.prompt}</span>
              {q.type === 'mcq' && (
                <div style={{ fontFamily: 'inherit', fontSize: 12, color: '#67625a', marginTop: 6 }}>
                  {(q.options || []).map((o) => `${o.key}) ${o.text}`).join('   ')} · correct: <b>{q.correct_key}</b>
                </div>
              )}
              {q.type === 'truefalse' && (
                <div style={{ fontFamily: 'inherit', fontSize: 12, color: '#67625a', marginTop: 6 }}>True / False · correct: <b>{q.correct_key}</b></div>
              )}
              {q.type === 'code' && (
                <div style={{ fontFamily: 'inherit', fontSize: 12, color: '#67625a', marginTop: 6 }}>Code · language: <b>{(LANGS.find((l) => l.monaco === q.code_lang) || {}).label || q.code_lang || 'Python'}</b></div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button className="btn" style={{ padding: '6px 14px', height: 'fit-content', fontSize: 18, lineHeight: 1 }}
                onClick={() => setMenuId(menuId === q.id ? null : q.id)}>⋯</button>
              {menuId === q.id && (
                <div style={{ position: 'absolute', right: 0, top: '108%', zIndex: 30, background: '#fff', border: '1px solid var(--line)', minWidth: 140, boxShadow: '4px 4px 0 rgba(19,19,17,.15)' }}>
                  {[['Edit', () => { if (locked) { toast('Locked — in use by a student.', 'err') } else { setEditing(q) } setMenuId(null) }],
                    ['Duplicate', () => duplicate(q)],
                    ['Delete', () => del(q)]].map(([label, fn]) => (
                    <button key={label} onClick={fn}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: label === 'Delete' ? '#d92d28' : '#131311' }}>
                      {label}{locked && label !== 'Duplicate' ? ' 🔒' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {editing && (
        <QuestionEditor question={editing} allowedTypes={allowedTypes} toast={toast}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); toast('Question updated') }} />
      )}
    </div>
  )
}

// ---------- Edit one question ----------
function QuestionEditor({ question, allowedTypes, toast, onClose, onSaved }) {
  const types = (allowedTypes && allowedTypes.length) ? allowedTypes : ALL_TYPES
  const [type, setType] = useState(question.type)
  const [prompt, setPrompt] = useState(question.prompt)
  const [correct, setCorrect] = useState(question.type === 'mcq' ? (question.correct_key || 'A') : 'A')
  const [tf, setTf] = useState(question.type === 'truefalse' ? (question.correct_key || 'True') : 'True')
  const [codeLang, setCodeLang] = useState(question.code_lang || 'python')
  const [points, setPoints] = useState(question.points || 1)
  const [busy, setBusy] = useState(false)
  const [opts, setOpts] = useState(() => {
    const o = { A: '', B: '', C: '', D: '' }
    ;(question.options || []).forEach((x) => { if (o[x.key] !== undefined) o[x.key] = x.text })
    return o
  })

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line

  async function save() {
    if (!prompt.trim()) { toast('Enter a prompt.', 'err'); return }
    const built = buildQuestion(type, prompt, opts, correct, tf, points, codeLang)
    if (built.error) { toast(built.error, 'err'); return }
    setBusy(true)
    const { error } = await supabase.from('questions').update(built.row).eq('id', question.id)
    setBusy(false)
    if (error) { toast(error.message, 'err'); return }
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,.6)', zIndex: 70, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#f2f1ec', border: '1px solid var(--line)', width: 560, maxWidth: '100%', padding: 26, marginTop: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-.5px' }}>Edit question</h2>
          <button className="btn" style={{ padding: '6px 12px' }} onClick={onClose} autoFocus>CLOSE ✕</button>
        </div>
        <label className="label">Type</label>
        <div style={{ marginTop: 6 }}><TypePicker types={types} type={type} setType={setType} /></div>
        <label className="label">Prompt</label>
        <textarea className="field" value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 80, margin: '6px 0 14px' }} />
        {type === 'code' && <LangPicker codeLang={codeLang} setCodeLang={setCodeLang} />}
        {type === 'truefalse' && (<div style={{ marginBottom: 14 }}><label className="label">Correct answer</label><TrueFalsePicker tf={tf} setTf={setTf} /></div>)}
        {type === 'mcq' && (
          <div style={{ marginBottom: 14 }}>
            <label className="label">Options — tick the correct one</label>
            {['A', 'B', 'C', 'D'].map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input type="radio" name="editcorrect" checked={correct === k} onChange={() => setCorrect(k)} />
                <span className="label" style={{ width: 14 }}>{k}</span>
                <input className="field" placeholder={`Option ${k}`} value={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="label">Points</span>
          <input className="field" type="number" aria-label="Points" min={1} value={points} onChange={(e) => setPoints(e.target.value)} style={{ width: 90 }} />
          <button className="btn btn-primary" onClick={save} disabled={busy} style={{ marginLeft: 'auto' }}>{busy ? 'SAVING…' : 'SAVE CHANGES →'}</button>
        </div>
      </div>
    </div>
  )
}

function buildQuestion(type, prompt, opts, correct, tf, points, codeLang) {
  let options = [], correct_key = null
  if (type === 'mcq') {
    options = Object.entries(opts).filter(([, v]) => v.trim()).map(([key, text]) => ({ key, text: text.trim() }))
    correct_key = correct
    if (options.length < 2 || !options.some((o) => o.key === correct)) return { error: 'Add at least two options and mark which one\'s correct.' }
  } else if (type === 'truefalse') {
    options = [{ key: 'True', text: 'True' }, { key: 'False', text: 'False' }]
    correct_key = tf
  }
  return { row: { type, prompt: prompt.trim(), options, correct_key, code_lang: type === 'code' ? (codeLang || 'python') : null, points: parseInt(points) || 1 } }
}

function LangPicker({ codeLang, setCodeLang }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="label">Language students code in</label>
      <select className="field" value={codeLang} onChange={(e) => setCodeLang(e.target.value)} style={{ marginTop: 4 }}>
        {LANGS.map((l) => <option key={l.monaco} value={l.monaco}>{l.label}</option>)}
      </select>
    </div>
  )
}

function TypePicker({ types, type, setType }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      {types.map((t) => (
        <button key={t} onClick={() => setType(t)} className="btn" style={{ padding: '8px 10px', fontSize: 11, background: type === t ? '#d92d28' : 'transparent', color: type === t ? '#fff' : '#131311', borderColor: type === t ? '#d92d28' : '#131311' }}>{TYPE_LABEL[t]}</button>
      ))}
    </div>
  )
}

function TrueFalsePicker({ tf, setTf }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      {['True', 'False'].map((k) => (
        <button key={k} onClick={() => setTf(k)} className="btn" style={{ flex: 1, background: tf === k ? '#131311' : 'transparent', color: tf === k ? '#f2f1ec' : '#131311' }}>
          {k}{tf === k ? ' ✓' : ''}
        </button>
      ))}
    </div>
  )
}

function AddQuestion({ quizId, allowedTypes, typePoints, toast, onChange }) {
  const types = (allowedTypes && allowedTypes.length) ? allowedTypes : ALL_TYPES
  const [type, setType] = useState(types[0])
  const [prompt, setPrompt] = useState('')
  const [opts, setOpts] = useState({ A: '', B: '', C: '', D: '' })
  const [correct, setCorrect] = useState('A')
  const [tf, setTf] = useState('True')
  const [codeLang, setCodeLang] = useState('python')
  const [points, setPoints] = useState((typePoints && typePoints[types[0]]) ?? 1)

  useEffect(() => { if (!types.includes(type)) setType(types[0]) }, [allowedTypes]) // eslint-disable-line
  useEffect(() => { if (typePoints && typePoints[type] != null) setPoints(typePoints[type]) }, [type]) // eslint-disable-line

  async function add() {
    if (!prompt.trim()) { toast('Enter a prompt.', 'err'); return }
    const built = buildQuestion(type, prompt, opts, correct, tf, points, codeLang)
    if (built.error) { toast(built.error, 'err'); return }
    const { error } = await supabase.from('questions').insert({ quiz_id: quizId, ...built.row })
    if (error) { toast(error.message, 'err'); return }
    setPrompt(''); setOpts({ A: '', B: '', C: '', D: '' }); onChange(); toast('Question added')
  }

  return (
    <div style={{ border: '1px solid var(--line)', padding: 18 }}>
      <div className="label" style={{ marginBottom: 12 }}>Add one question</div>
      <TypePicker types={types} type={type} setType={setType} />
      <textarea className="field" placeholder="Question prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 70, marginBottom: 10 }} />
      {type === 'code' && <LangPicker codeLang={codeLang} setCodeLang={setCodeLang} />}
      {type === 'truefalse' && (<><label className="label">Correct answer</label><TrueFalsePicker tf={tf} setTf={setTf} /></>)}
      {type === 'mcq' && ['A', 'B', 'C', 'D'].map((k) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input type="radio" name="correct" checked={correct === k} onChange={() => setCorrect(k)} title="Mark correct" />
          <span className="label" style={{ width: 14 }}>{k}</span>
          <input className="field" placeholder={`Option ${k}`} value={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.value })} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <span className="label">Points</span>
        <input className="field" type="number" aria-label="Points" min={1} value={points} onChange={(e) => setPoints(e.target.value)} style={{ width: 80 }} />
        <button className="btn btn-primary" onClick={add} style={{ marginLeft: 'auto' }}>ADD →</button>
      </div>
    </div>
  )
}

function BulkAdd({ quizId, allowedTypes, toast, onChange }) {
  const [text, setText] = useState('')
  const fileRef = useRef(null)
  const template = 'type,prompt,option_a,option_b,option_c,option_d,correct,points\nmcq,"Capital of France?",Paris,London,Rome,Berlin,A,1\ntext,"Explain gravity.",,,,,,2\ncode,"Reverse a string in Python.",,,,,,3'

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result || '')); toast(`Loaded "${file.name}" — click Import`) }
    reader.readAsText(file)
  }

  async function importAll() {
    const { ok: rows, bad } = csvToQuestions(text)
    if (!rows.length) { toast('Couldn\'t read any questions — double-check the format and try again.', 'err'); return }
    const allowed = new Set(allowedTypes && allowedTypes.length ? allowedTypes : ALL_TYPES)
    const kept = rows.filter((r) => allowed.has(r.type))
    const skipped = rows.length - kept.length + bad
    if (!kept.length) { toast(`Skipped all — this quiz only allows: ${[...allowed].join(', ')}.`, 'err'); return }
    const { error } = await supabase.from('questions').insert(kept.map((r) => ({ quiz_id: quizId, ...r })))
    if (error) { toast(error.message, 'err'); return }
    toast(`Imported ${kept.length}${skipped ? ` · skipped ${skipped}` : ''}`)
    setText(''); if (fileRef.current) fileRef.current.value = ''; onChange()
  }

  return (
    <div style={{ border: '1px solid var(--line)', padding: 18 }}>
      <div className="label" style={{ marginBottom: 12 }}>Bulk add questions</div>
      <label className="btn btn-primary" style={{ display: 'inline-block', marginBottom: 12 }}>
        CHOOSE CSV FILE
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
      </label>
      <p style={{ fontSize: 12, color: '#67625a', marginTop: 0 }}>
        …or paste CSV below. First row = headers: type, prompt, option_a…d, correct (A/B/C/D), points.
      </p>
      <textarea className="field" style={{ minHeight: 130, fontFamily: 'inherit', fontSize: 12 }}
        placeholder={template} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={importAll}>IMPORT →</button>
        <button className="btn" onClick={() => setText(template)}>USE EXAMPLE</button>
      </div>
    </div>
  )
}

// ---------- Results tab ----------
function ResultsTab({ quiz, students, questions, toast, onChange, onQuizChange }) {
  const [sel, setSel] = useState(null)
  const [stats, setStats] = useState(null)
  const [q, setQ] = useState('')
  const [roster, setRoster] = useState([])
  const [emailing, setEmailing] = useState(false)

  // load the uploaded roster (for attendance: who hasn't attempted)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('roster').select('id,name,student_id_txt').eq('quiz_id', quiz.id)
      if (alive) setRoster(data || [])
    })()
    return () => { alive = false }
  }, [quiz.id, students.length])

  // analytics: summary tiles from students; hardest questions from answers
  useEffect(() => {
    const submitted = students.filter((s) => s.status === 'submitted')
    let avgPct = null, passRate = null, avgMin = null
    if (submitted.length) {
      const pcts = submitted.filter((s) => s.total_points).map((s) => (s.score / s.total_points) * 100)
      if (pcts.length) avgPct = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
      if (quiz.pass_score != null && pcts.length) passRate = Math.round(100 * pcts.filter((p) => p >= quiz.pass_score).length / pcts.length)
      const times = submitted.filter((s) => s.started_at && s.submitted_at)
        .map((s) => (new Date(s.submitted_at) - new Date(s.started_at)) / 60000)
      if (times.length) avgMin = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    }
    setStats((prev) => ({ ...(prev || {}), submitted: submitted.length, avgPct, passRate, avgMin }))

    // hardest questions (needs answers)
    let alive = true
    ;(async () => {
      const sids = students.map((s) => s.id)
      if (!sids.length) { setStats((p) => ({ ...(p || {}), hardest: [] })); return }
      const { data: ans } = await supabase.from('answers').select('student_id,question_id,is_correct,awarded').in('student_id', sids)
      if (!alive || !ans) return
      const typeById = Object.fromEntries(questions.map((q) => [q.id, q.type]))
      const map = {}
      const needSet = new Set()
      ans.forEach((a) => {
        const m = map[a.question_id] || { t: 0, c: 0 }; m.t++; if (a.is_correct) m.c++; map[a.question_id] = m
        const ty = typeById[a.question_id]
        if ((ty === 'text' || ty === 'code') && a.awarded == null) needSet.add(a.student_id)
      })
      const byId = Object.fromEntries(questions.map((q) => [q.id, q.prompt]))
      const hardest = Object.entries(map).map(([id, m]) => ({ prompt: byId[id] || '(question)', pct: Math.round(100 * m.c / m.t), n: m.t }))
        .sort((a, b) => a.pct - b.pct).slice(0, 5)
      setStats((p) => ({ ...(p || {}), hardest, needGrade: [...needSet] }))
    })()
    return () => { alive = false }
  }, [students, questions, quiz.pass_score]) // eslint-disable-line

  async function reallow(s) {
    if (!window.confirm(`Give ${s.name} a fresh attempt? This clears their answers and recordings.`)) return
    try { await rpc('teacher_reallow_student', { p_student_id: s.id }); onChange(); toast(`${s.name} can retake`) }
    catch (e) { toast(e.message, 'err') }
  }
  const published = !!quiz.results_published
  async function togglePublish() {
    const next = !published
    if (next && !window.confirm('Publish results? This freezes all grading until you unpublish, and lets you email students their results.')) return
    const { data, error } = await supabase.from('quizzes')
      .update({ results_published: next, results_published_at: next ? new Date().toISOString() : null })
      .eq('id', quiz.id).select().single()
    if (error) { toast(error.message, 'err'); return }
    onQuizChange && onQuizChange(data)
    toast(next ? 'Results published — grading locked' : 'Results unpublished — you can edit again')
  }
  async function emailAll() {
    const pending = students.filter((s) => s.status === 'submitted' && s.email && !s.results_emailed_at)
    if (!pending.length) { toast('No one left to email — everyone submitted has already been sent their result.'); return }
    if (!window.confirm(`Email results to ${pending.length} student(s) who haven't been sent yet?`)) return
    setEmailing(true)
    const { data, error } = await supabase.functions.invoke('send-results-all', { body: { quiz_id: quiz.id } })
    setEmailing(false)
    if (error) { toast(error.message || 'Email failed', 'err'); return }
    onChange()
    toast(`Emailed ${data?.sent ?? 0}${data?.failed ? ` · ${data.failed} failed` : ''}`, data?.failed ? 'err' : undefined)
  }
  async function emailOne(s) {
    if (!s.email) { toast('That student hasn\'t given an email yet.', 'err'); return }
    setEmailing(true)
    const { data, error } = await supabase.functions.invoke('send-results-all', { body: { quiz_id: quiz.id, student_id: s.id } })
    setEmailing(false)
    if (error) { toast(error.message || 'Email failed', 'err'); return }
    onChange()
    toast(data?.failed ? `Failed: ${(data.errors || [])[0] || 'see logs'}` : `Result emailed to ${s.name || s.email}`, data?.failed ? 'err' : undefined)
  }
  const badge = (s) => {
    const LBL = { submitted: 'Submitted', in_progress: 'In progress', blocked: 'Blocked', not_attempted: 'Not attempted', not_started: 'Not started', registered: 'Registered' }
    const cls = s.status === 'submitted' ? 'good' : s.status === 'in_progress' ? 'warn' : s.status === 'blocked' ? 'bad' : 'neutral'
    const txt = LBL[s.status] || (s.status.charAt(0).toUpperCase() + s.status.slice(1))
    return <span className={`chip ${cls}`}><span className="led"></span>{txt}</span>
  }
  const tile = (label, val) => (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div className="label" style={{ fontSize: 11.5, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div className="tnum" style={{ fontWeight: 700, fontSize: 28, letterSpacing: '-.02em', marginTop: 8 }}>{val}</div>
    </div>
  )

  const graded = students.filter((s) => s.status === 'submitted' && s.total_points)
  const spread = [0, 0, 0, 0, 0]
  graded.forEach((s) => { const pct = (s.score / s.total_points) * 100; spread[Math.min(4, Math.floor(pct / 20))]++ })
  const spreadMax = Math.max(1, ...spread)
  const spreadCaps = ['0–20', '21–40', '41–60', '61–80', '81–100']
  const gaugeP = stats?.passRate != null ? stats.passRate : (stats?.avgPct != null ? stats.avgPct : 0)
  const gaugeHas = stats?.passRate != null || stats?.avgPct != null
  const needGrade = new Set(stats?.needGrade || [])
  const hasRoster = roster.length > 0
  const pendingCount = students.filter((s) => s.status === 'submitted' && s.email && !s.results_emailed_at).length
  const seen = new Set(students.map((s) => (s.student_id_txt || '').toLowerCase()))
  const notAttempted = hasRoster
    ? roster
        .filter((r) => !seen.has((r.student_id_txt || '').toLowerCase()))
        .map((r) => ({ id: `roster-${r.id}`, name: r.name || '(no name)', student_id_txt: r.student_id_txt, email: '', status: 'not_attempted', score: null, total_points: null, warnings: 0, _synthetic: true }))
    : []
  const allRows = [...students, ...notAttempted]
  const rosterTotal = hasRoster ? roster.length : quiz.num_students
  const shown = allRows.filter((s) => {
    const t = q.trim().toLowerCase()
    if (!t) return true
    return (s.name || '').toLowerCase().includes(t) || (s.student_id_txt || '').toLowerCase().includes(t) || (s.email || '').toLowerCase().includes(t)
  })

  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`chip ${published ? 'good' : 'neutral'}`}><span className="led"></span>{published ? 'Results published' : 'Draft — not published'}</span>
          <span className="label" style={{ margin: 0, color: 'var(--muted)' }}>{published ? 'Grading is locked. You can email students their results.' : 'Publish to lock grades and email results.'}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {published && <button className="btn btn-primary" disabled={emailing} onClick={emailAll}>{emailing ? 'Emailing…' : `Email all (${pendingCount})`}</button>}
          <button className="btn" onClick={togglePublish} style={published ? {} : { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}>{published ? 'Unpublish to edit' : 'Publish results'}</button>
        </div>
      </div>
      {/* summary */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
          {tile('Submitted', `${stats.submitted}/${rosterTotal}`)}
          {tile('Average', stats.avgPct != null ? `${stats.avgPct}%` : '—')}
          {tile('Pass rate', stats.passRate != null ? `${stats.passRate}%` : '—')}
          {tile('Avg time', stats.avgMin != null ? `${stats.avgMin}m` : '—')}
        </div>
      )}

      {stats && graded.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12, marginBottom: 18 }}>
          <div className="card">
            <div className="label" style={{ marginBottom: 12 }}>{stats.passRate != null ? 'Pass rate' : 'Average score'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 116, height: 116, flex: 'none', borderRadius: '50%', background: `conic-gradient(var(--ink) ${gaugeP}%, var(--track) 0)` }}>
                <div style={{ position: 'absolute', inset: 14, background: 'var(--card)', borderRadius: '50%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                  <div>
                    <div className="tnum" style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.02em' }}>{gaugeHas ? gaugeP + '%' : '—'}</div>
                    <div className="label" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{stats.passRate != null ? 'passed' : 'avg'}</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                {stats.submitted} submitted{quiz.pass_score != null ? ` · pass mark ${quiz.pass_score}%` : ''}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="label" style={{ marginBottom: 12 }}>Score spread</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 116 }}>
              {spread.map((n, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <div className="tnum" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>{n}</div>
                  <div style={{ width: '100%', maxWidth: 32, height: `${Math.max(4, (n / spreadMax) * 100)}%`, background: 'var(--ink)', borderRadius: '6px 6px 2px 2px' }}></div>
                  <div className="label" style={{ fontSize: 10.5 }}>{spreadCaps[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or student ID…" style={{ maxWidth: 300 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="label">{q.trim() ? `${shown.length} of ${allRows.length}` : hasRoster ? `${students.length}/${rosterTotal} attempted` : `${students.length} student(s)`} · auto-updates</span>
          <button className="btn" style={{ padding: '8px 14px' }} onClick={onChange}>↻ Refresh</button>
        </div>
      </div>

      {!allRows.length
        ? <p style={{ color: '#67625a' }}>{hasRoster ? 'Roster is empty.' : 'No students have started yet.'}</p>
        : (
          <div className="card" style={{ overflowX: 'auto', padding: '4px 8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  {['Student', 'Status', 'Score', 'Warnings', 'Actions'].map((h) => (<th key={h} className="label" style={{ padding: '10px 8px' }}>{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontFamily: 'inherit', fontSize: 12, color: '#67625a' }}>{s.student_id_txt || s.email}</div>
                      {recFlags(s)}
                      {s.status === 'submitted' && needGrade.has(s.id) && (
                        <div style={{ marginTop: 4 }}><span className="chip warn"><span className="led"></span>needs grading</span></div>
                      )}
                      {s.results_email_error
                        ? <div style={{ marginTop: 4 }}><span className="chip bad"><span className="led"></span>result email failed</span></div>
                        : s.results_emailed_at
                          ? <div style={{ marginTop: 4 }}><span className="chip good"><span className="led"></span>result sent</span></div>
                          : null}
                    </td>
                    <td style={{ padding: '12px 8px' }}>{badge(s)}</td>
                    <td style={{ padding: '12px 8px', fontFamily: 'inherit' }}>{s.score != null ? `${s.score}/${s.total_points}` : '—'}</td>
                    <td style={{ padding: '12px 8px', fontFamily: 'inherit', color: s.warnings ? '#d92d28' : '#67625a' }}>{s.warnings}</td>
                    <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                      {s._synthetic
                        ? <span className="label" style={{ color: '#67625a' }}>—</span>
                        : (<>
                            <button className="btn btn-primary" style={{ padding: '6px 12px', marginRight: 6 }} onClick={() => setSel(s)}>VIEW</button>
                            {published
                              ? <button className="btn" style={{ padding: '6px 12px' }} disabled={emailing || s.status !== 'submitted' || !s.email} onClick={() => emailOne(s)}>{s.results_emailed_at ? 'RESEND' : 'EMAIL'}</button>
                              : <button className="btn" style={{ padding: '6px 12px' }} onClick={() => reallow(s)}>RE-ALLOW</button>}
                          </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {stats?.hardest?.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="label" style={{ marginBottom: 8 }}>Hardest questions (lowest % correct)</div>
          {stats.hardest.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontFamily: 'inherit', fontWeight: 700, color: h.pct < 50 ? '#d92d28' : '#131311', width: 48 }}>{h.pct}%</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.prompt}</span>
              <span className="label">{h.n} ans</span>
            </div>
          ))}
        </div>
      )}

      {sel && <StudentDetail student={sel} onClose={() => setSel(null)} onGraded={onChange} toast={toast} frozen={published} />}
    </div>
  )
}

// ---------- Student detail (videos + answers + grading) ----------
function StudentDetail({ student, onClose, onGraded, toast, frozen }) {
  const [answers, setAnswers] = useState([])
  const [camUrls, setCamUrls] = useState([])
  const [scrUrls, setScrUrls] = useState([])
  const [loading, setLoading] = useState(true)
  const [score, setScore] = useState(student.score)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const { data: ans } = await supabase.from('answers')
        .select('*, questions(prompt,type,options,correct_key,points,code_lang)').eq('student_id', student.id)
      // A stored value is either a single legacy file ("…/camera-123.webm")
      // or a segment-folder prefix ("<student>/<attempt>/camera"). Resolve
      // both into an ordered list of signed clip URLs.
      const resolve = async (stored) => {
        if (!stored) return []
        if (/\.webm$/i.test(stored)) {
          const { data } = await supabase.storage.from('recordings').createSignedUrl(stored, 3600)
          return data?.signedUrl ? [data.signedUrl] : []
        }
        const { data: files } = await supabase.storage.from('recordings')
          .list(stored, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
        const paths = (files || [])
          .filter((f) => /\.webm$/i.test(f.name))
          .map((f) => `${stored}/${f.name}`)
          .sort()
        if (!paths.length) return []
        const { data: signed } = await supabase.storage.from('recordings').createSignedUrls(paths, 3600)
        return (signed || []).map((s) => s.signedUrl).filter(Boolean)
      }
      const cam = await resolve(student.camera_url); const scr = await resolve(student.screen_url)
      if (!alive) return
      setAnswers(ans || []); setCamUrls(cam); setScrUrls(scr); setLoading(false)
    }
    load(); return () => { alive = false }
  }, [student.id]) // eslint-disable-line

  async function grade(answerId, awarded) {
    if (frozen) { toast('Results are published — unpublish to edit grades.', 'err'); return }
    try {
      const res = await rpc('teacher_grade_answer', { p_answer_id: answerId, p_awarded: awarded })
      setScore(res.score)
      setAnswers((a) => a.map((x) => x.id === answerId ? { ...x, awarded, is_correct: awarded > 0 } : x))
      onGraded && onGraded(); toast('Grade saved')
    } catch (e) { toast(e.message, 'err') }
  }

  const manualAns = answers.filter((a) => { const t = a.questions?.type; return t === 'text' || t === 'code' })
  const manualDone = manualAns.filter((a) => a.awarded != null).length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,.6)', zIndex: 50, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#f2f1ec', border: '1px solid var(--line)', width: 900, maxWidth: '100%', padding: 28, marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-.6px' }}>{student.name}</h2>
            <div className="label">{student.student_id_txt ? `ID ${student.student_id_txt} · ` : ''}{student.email} · warnings: {student.warnings}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'inherit', fontSize: 22, fontWeight: 700 }}>{score != null ? `${score}/${student.total_points}` : '—'}</div>
            <button className="btn" style={{ padding: '6px 14px', marginTop: 6 }} onClick={onClose} autoFocus>CLOSE ✕</button>
          </div>
        </div>

        {loading ? <p style={{ fontFamily: 'inherit' }}>Loading…</p> : (
          <>
            <div className="label" style={{ margin: '20px 0 8px' }}>Recordings (private — only you)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {camUrls.length
                ? <RecordingPlayer label="Camera + mic" sources={camUrls} />
                : <div className="label" style={{ color: '#d92d28', fontWeight: 700 }}>⚠ No camera recording (upload failed or was blocked)</div>}
              {scrUrls.length
                ? <RecordingPlayer label="Screen" sources={scrUrls} />
                : <div className="label">No screen recording</div>}
            </div>

            <div className="label" style={{ margin: '16px 0 0' }}>
              Report email: {student.report_email_error
                ? <span style={{ color: '#d92d28', fontWeight: 700 }}>⚠ failed ({student.report_email_error})</span>
                : student.report_emailed_at
                  ? <span style={{ color: '#198048', fontWeight: 700 }}>✓ sent</span>
                  : <span style={{ color: '#67625a' }}>— not recorded (older submission or still sending)</span>}
            </div>
            <div style={{ margin: '24px 0 8px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="label" style={{ margin: 0 }}>Answers</span>
              {frozen && <span className="chip neutral" style={{ fontSize: 11 }}><span className="led"></span>frozen — unpublish to edit</span>}
              {manualAns.length > 0 && (
                <span className={`chip ${manualDone === manualAns.length ? 'good' : 'warn'}`} style={{ fontSize: 11 }}><span className="led"></span>{manualDone}/{manualAns.length} manual graded</span>
              )}
            </div>
            {answers.length === 0 && <p style={{ color: '#67625a' }}>No answers recorded.</p>}
            {answers.map((a) => {
              const q = a.questions || {}
              const autoGraded = q.type === 'mcq' || q.type === 'truefalse'
              return (
                <div key={a.id} style={{ border: '1px solid var(--line)', background: '#fff', padding: 16, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'inherit', fontSize: 11, background: '#131311', color: '#fff', padding: '2px 7px' }}>{TYPE_LABEL[q.type] || (q.type || '').toUpperCase()}</span>
                    <span style={{ fontWeight: 700 }}>{q.prompt}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'inherit', fontSize: 12, color: '#67625a' }}>{q.points} pt</span>
                  </div>
                  {q.type === 'code'
                    ? <CodeEditor langId={q.code_lang} value={a.response || ''} readOnly height={220} />
                    : (
                      <div style={{ fontSize: 15, whiteSpace: 'pre-wrap', background: '#f7f6f1', padding: 12, border: '1px solid var(--line)' }}>
                        {a.response || <span style={{ color: '#999' }}>(no answer)</span>}
                      </div>
                    )}
                  {autoGraded ? (
                    <div style={{ marginTop: 8, fontFamily: 'inherit', fontSize: 13 }}>
                      {a.is_correct ? <span style={{ color: '#198048' }}>✓ Correct (+{q.points})</span>
                        : <span style={{ color: '#d92d28' }}>✗ Wrong · correct answer: {q.correct_key}</span>}
                    </div>
                  ) : <GradeRow answer={a} maxPoints={q.points || 0} onGrade={grade} frozen={frozen} />}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function fmtTime(t) {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Plays a recording made of one or more clips back-to-back as a single
// timeline. When a clip ends it auto-advances to the next; the numbered
// buttons let the teacher jump to any clip. A single-clip recording (or a
// legacy single-file one) just shows one video.
function RecordingPlayer({ label, sources }) {
  const ref = useRef(null)
  const [i, setI] = useState(0)
  const n = sources.length
  const idx = Math.min(i, Math.max(0, n - 1))
  const src = sources[idx]

  // When the current clip ends, roll on to the next one.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const onEnded = () => { setI((k) => (k < n - 1 ? k + 1 : k)) }
    v.addEventListener('ended', onEnded)
    return () => v.removeEventListener('ended', onEnded)
  }, [n])

  // Auto-play clips after the first (the teacher already pressed play on #1,
  // so the browser allows continuing the chain). If it's blocked, the numbered
  // buttons still work.
  const first = useRef(true)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (first.current) { first.current = false; return }
    v.play().catch(() => {})
  }, [src])

  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>
        {label}{n > 1 ? ` · clip ${idx + 1} of ${n}` : ''}
      </div>
      <video ref={ref} src={src} controls style={{ width: '100%', background: '#000' }} />
      {n > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {sources.map((_, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              title={`Clip ${k + 1}`}
              style={{
                fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                padding: '2px 8px', borderRadius: 6, border: '1px solid var(--line)',
                background: k === idx ? '#131311' : '#fff', color: k === idx ? '#fff' : '#131311',
              }}
            >{k + 1}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Small warning badges for a student row (missing camera / failed email).
function recFlags(s) {
  const flags = []
  if (s.status === 'submitted' && !s.camera_url) flags.push('⚠ no camera')
  if (s.report_email_error) flags.push('⚠ email failed')
  if (!flags.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {flags.map((t, i) => (
        <span key={i} style={{ fontFamily: 'inherit', fontSize: 10, color: '#d92d28', border: '1px solid #d92d28', padding: '1px 5px' }}>{t}</span>
      ))}
    </div>
  )
}

// --- roster parsing: auto-detect which column is the student ID vs the name ---
let _xlsxPromise = null
function loadXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX)
  if (_xlsxPromise) return _xlsxPromise
  _xlsxPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    sc.onload = () => resolve(window.XLSX)
    sc.onerror = () => reject(new Error('could not load the Excel reader'))
    document.head.appendChild(sc)
  })
  return _xlsxPromise
}

function idScore(v) {
  v = String(v == null ? '' : v).trim()
  if (!v) return -1
  let s = 0
  if (/\d/.test(v)) s += 2
  if (/[-/]/.test(v)) s += 1
  if (!/\s/.test(v)) s += 1
  else s -= 1
  if (v.length <= 15) s += 1
  return s
}

// matrix = array of rows, each an array of cell values. Returns [{name, student_id_txt}].
function detectRoster(matrix) {
  let m = (matrix || [])
    .map((r) => (r || []).map((c) => (c == null ? '' : String(c)).trim()))
    .filter((r) => r.some((c) => c !== ''))
  if (!m.length) return []

  const hdr = m[0]
  const looksHeader =
    hdr.some((c) => /^(student\s*name|name|student\s*id|student|id|roll\s*n?o?\.?|reg(istration)?\s*n?o?\.?|email)$/i.test(c)) &&
    !hdr.some((c) => /\d{2,}/.test(c))
  let idCol = -1, nameCol = -1
  if (looksHeader) {
    hdr.forEach((c, i) => {
      if (idCol < 0 && /\b(id|roll|reg|registration)\b/i.test(c)) idCol = i
      if (nameCol < 0 && /name/i.test(c) && !/\bid\b/i.test(c)) nameCol = i
    })
    m = m.slice(1)
  }
  if (!m.length) return []
  const ncols = Math.max(...m.map((r) => r.length))

  if (idCol < 0) {
    let best = -1, bestScore = -Infinity
    for (let i = 0; i < ncols; i++) {
      let sum = 0, cnt = 0
      m.forEach((r) => { if (r[i]) { sum += idScore(r[i]); cnt++ } })
      const avg = cnt ? sum / cnt : -Infinity
      if (avg > bestScore) { bestScore = avg; best = i }
    }
    idCol = best < 0 ? 0 : best
  }
  if (nameCol < 0) {
    let best = -1, bestScore = -Infinity
    for (let i = 0; i < ncols; i++) {
      if (i === idCol) continue
      let sum = 0, cnt = 0
      m.forEach((r) => {
        const v = r[i]
        if (v != null && v !== '') { sum += (/\s/.test(v) ? 2 : 0) + (/[A-Za-z]/.test(v) ? 1 : 0) - (/\d/.test(v) ? 1 : 0); cnt++ }
      })
      const avg = cnt ? sum / cnt : -Infinity
      if (avg > bestScore) { bestScore = avg; best = i }
    }
    nameCol = best
  }

  const out = []
  for (const r of m) {
    const sid = (r[idCol] || '').trim()
    if (!sid) continue
    const name = nameCol >= 0 ? (r[nameCol] || '').trim() : ''
    out.push({ name, student_id_txt: sid })
  }
  return out
}

function RosterTab({ quiz, toast }) {
  const [rows, setRows] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  async function load() {
    const { data } = await supabase.from('roster').select('*').eq('quiz_id', quiz.id).order('created_at')
    setRows(data || [])
  }
  useEffect(() => { load() }, [quiz.id]) // eslint-disable-line

  function parse(raw) {
    const matrix = raw.split(/\r?\n/).map((l) => l.split(/[,\t]/))
    return detectRoster(matrix)
  }

  async function saveParsed(parsed) {
    if (!parsed.length) { toast('Couldn\'t find any names — put one student per line: their name and student ID, in any order.', 'err'); return }
    const seen = new Set(); const uniq = []
    for (const pr of parsed) { const k = pr.student_id_txt.toLowerCase(); if (seen.has(k)) continue; seen.add(k); uniq.push(pr) }
    setBusy(true)
    await supabase.from('roster').delete().eq('quiz_id', quiz.id)
    const payload = uniq.map((pr) => ({ quiz_id: quiz.id, name: pr.name || null, student_id_txt: pr.student_id_txt }))
    const { error } = await supabase.from('roster').insert(payload)
    setBusy(false)
    if (error) { toast(error.message, 'err'); return }
    setText(''); await load(); toast(`Roster saved — ${uniq.length} student(s)`)
  }
  async function save(raw) { return saveParsed(parse(raw)) }

  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    e.target.value = ''
    const fn = (f.name || '').toLowerCase()
    if (fn.endsWith('.xlsx') || fn.endsWith('.xls')) {
      try {
        const XLSX = await loadXLSX()
        const buf = await f.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
        await saveParsed(detectRoster(matrix))
      } catch (err) { toast('Could not read that Excel file: ' + (err.message || err), 'err') }
    } else {
      const r = new FileReader()
      r.onload = () => save(String(r.result || ''))
      r.readAsText(f)
    }
  }

  async function removeRow(id) { await supabase.from('roster').delete().eq('id', id); load() }
  async function clearAll() {
    if (!window.confirm('Remove the entire roster for this quiz? Anyone with the link will be able to register again.')) return
    await supabase.from('roster').delete().eq('quiz_id', quiz.id); load(); toast('Roster cleared')
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>Class roster</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
          Upload your class list to restrict this quiz to only these students. Paste one student per line, or upload a <b>CSV or Excel</b> file — name and student ID in any order (I detect which is which). Student ID is required; students enter their own email when they take the quiz. Saving replaces the current roster. Leave it empty to let anyone with the link register.
        </p>
        <textarea className="field" style={{ minHeight: 110, fontSize: 13 }} placeholder={'Ayesha Khan, K21-3391\nBilal Ahmed, K21-3404'} value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => save(text)}>{busy ? 'Saving…' : 'Save roster'}</button>
          <label className="btn" style={{ cursor: 'pointer' }}>Upload CSV / Excel<input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={onFile} style={{ display: 'none' }} /></label>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}>
          <span className="label" style={{ margin: 0 }}>{rows.length} on the roster{rows.length ? '' : ' — restriction off'}</span>
          {rows.length > 0 && <button className="btn btn-sm" onClick={clearAll} style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>Clear roster</button>}
        </div>
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr>{['Name', 'Student ID', ''].map((h) => <th key={h} className="label" style={{ textAlign: 'left', padding: '8px 16px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 16px' }}>{r.name || '—'}</td>
                    <td style={{ padding: '10px 16px', fontWeight: 600 }}>{r.student_id_txt}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}><button className="btn btn-sm" onClick={() => removeRow(r.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function GradeRow({ answer, maxPoints, onGrade, frozen }) {
  const [val, setVal] = useState(answer.awarded ?? '')
  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="label">Award points (0–{maxPoints})</span>
      <input className="field" type="number" aria-label="Points to award" min={0} max={maxPoints} value={val} disabled={frozen} onChange={(e) => setVal(e.target.value)} style={{ width: 90 }} />
      <button className="btn btn-primary" style={{ padding: '8px 14px' }} disabled={frozen}
        onClick={() => onGrade(answer.id, Math.max(0, Math.min(parseFloat(val) || 0, maxPoints)))}>SAVE GRADE</button>
      {answer.awarded != null && <span style={{ fontFamily: 'inherit', fontSize: 12, color: '#198048' }}>graded: {answer.awarded}</span>}
    </div>
  )
}
