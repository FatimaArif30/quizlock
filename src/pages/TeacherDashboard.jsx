import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'

const ALL_TYPES = ['mcq', 'text', 'code']

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
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (name) => header.indexOf(name)
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const get = (n) => { const j = idx(n); return j >= 0 ? (r[j] || '').trim() : '' }
    const type = (get('type') || 'mcq').toLowerCase()
    const prompt = get('prompt')
    if (!prompt) continue
    const points = parseInt(get('points'), 10) || 1
    let options = [], correct_key = null
    if (type === 'mcq') {
      const map = { A: get('option_a'), B: get('option_b'), C: get('option_c'), D: get('option_d') }
      options = Object.entries(map).filter(([, v]) => v).map(([key, text]) => ({ key, text }))
      correct_key = (get('correct') || '').toUpperCase() || null
    }
    out.push({ type, prompt, options, correct_key, points })
  }
  return out
}

export default function TeacherDashboard() {
  const nav = useNavigate()
  const [user, setUser] = useState(null)
  const [quizzes, setQuizzes] = useState([])
  const [active, setActive] = useState(null) // selected quiz
  const [questions, setQuestions] = useState([])
  const [students, setStudents] = useState([])
  const [tab, setTab] = useState('questions')
  const [msg, setMsg] = useState('')

  // ---- auth gate ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { nav('/teacher/login'); return }
      setUser(data.session.user)
    })
  }, [nav])

  useEffect(() => { if (user) loadQuizzes() }, [user])

  // Live results: re-fetch the open quiz's students/questions every 8s.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => { reloadData(active) }, 8000)
    return () => clearInterval(id)
  }, [active?.id]) // eslint-disable-line

  async function loadQuizzes() {
    const { data } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false })
    setQuizzes(data || [])
  }
  async function reloadData(q) {
    const [{ data: qs }, { data: st }] = await Promise.all([
      supabase.from('questions').select('*').eq('quiz_id', q.id).order('created_at'),
      supabase.from('students').select('*').eq('quiz_id', q.id).order('created_at'),
    ])
    setQuestions(qs || []); setStudents(st || [])
  }
  async function openQuiz(q) {
    setActive(q); setTab('questions'); await reloadData(q)
  }
  async function refreshActive() { if (active) await reloadData(active) }

  async function logout() { await supabase.auth.signOut(); nav('/teacher/login') }

  if (!user) return null

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderBottom: '2px solid #131311' }}>
        <span style={{ fontWeight: 800, fontSize: 20 }}>QUIZLOCK<span style={{ color: '#e5322d' }}>.</span></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="label">{user.email}</span>
          <button className="btn" onClick={logout} style={{ padding: '10px 16px' }}>LOG OUT</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar: quizzes */}
        <div style={{ width: 300, borderRight: '2px solid #131311', padding: 20, overflowY: 'auto' }}>
          <NewQuiz onCreated={loadQuizzes} teacherId={user.id} setMsg={setMsg} />
          <div className="label" style={{ margin: '22px 0 10px' }}>Your quizzes</div>
          {quizzes.map((q) => (
            <button key={q.id} onClick={() => openQuiz(q)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
                       border: '2px solid #131311', background: active?.id === q.id ? '#131311' : '#fff', color: active?.id === q.id ? '#f2f1ec' : '#131311' }}>
              <div style={{ fontWeight: 700 }}>{q.title}</div>
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, opacity: .7 }}>
                {q.num_students} students · {q.questions_per_student} each
              </div>
            </button>
          ))}
          {!quizzes.length && <p style={{ fontSize: 13, color: '#757064' }}>No quizzes yet — create one above.</p>}
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
          {!active && <p style={{ color: '#757064' }}>Select or create a quiz to begin.</p>}
          {active && (
            <QuizPanel
              quiz={active} questions={questions} students={students} tab={tab} setTab={setTab}
              onChange={refreshActive} onQuizChange={(q) => { setActive(q); loadQuizzes() }}
            />
          )}
        </div>
      </div>
      {msg && <div style={{ position: 'fixed', bottom: 16, left: 16, background: '#131311', color: '#fff', padding: '10px 16px', fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{msg}</div>}
    </div>
  )
}

// ---------- New quiz form ----------
function NewQuiz({ onCreated, teacherId, setMsg }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [nStu, setNStu] = useState(10)
  const [perStu, setPerStu] = useState(10)
  const [dur, setDur] = useState(30)
  const [types, setTypes] = useState({ mcq: true, text: true, code: true })
  const needed = (parseInt(nStu) || 0) * (parseInt(perStu) || 0)
  const chosen = ALL_TYPES.filter((t) => types[t])

  async function create() {
    if (!title.trim()) return
    if (!chosen.length) { setMsg('Pick at least one question type.'); return }
    const { error } = await supabase.from('quizzes').insert({
      teacher_id: teacherId, title: title.trim(),
      num_students: parseInt(nStu) || 1, questions_per_student: parseInt(perStu) || 1,
      duration_minutes: parseInt(dur) || 30, allowed_types: chosen,
    })
    if (error) { setMsg(error.message); return }
    setTitle(''); setOpen(false); onCreated()
  }

  if (!open) return <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setOpen(true)}>+ NEW QUIZ</button>

  return (
    <div style={{ border: '2px solid #131311', padding: 16 }}>
      <div className="label" style={{ marginBottom: 10 }}>New quiz</div>
      <input className="field" placeholder="Quiz title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 10 }} />
      <label className="label">How many students?</label>
      <input className="field" type="number" min={1} value={nStu} onChange={(e) => setNStu(e.target.value)} style={{ margin: '4px 0 10px' }} />
      <label className="label">Questions per student?</label>
      <input className="field" type="number" min={1} value={perStu} onChange={(e) => setPerStu(e.target.value)} style={{ margin: '4px 0 10px' }} />
      <label className="label">Time limit (minutes)</label>
      <input className="field" type="number" min={1} value={dur} onChange={(e) => setDur(e.target.value)} style={{ margin: '4px 0 10px' }} />

      <label className="label">Question types in this quiz</label>
      <div style={{ display: 'flex', gap: 8, margin: '6px 0 12px' }}>
        {ALL_TYPES.map((t) => (
          <button type="button" key={t} onClick={() => setTypes({ ...types, [t]: !types[t] })} className="btn"
            style={{ padding: '8px 12px', flex: 1, background: types[t] ? '#131311' : 'transparent', color: types[t] ? '#f2f1ec' : '#131311' }}>
            {t.toUpperCase()} {types[t] ? '✓' : ''}
          </button>
        ))}
      </div>

      <div style={{ background: '#131311', color: '#f2f1ec', padding: '10px 12px', fontFamily: "'Space Mono',monospace", fontSize: 12, marginBottom: 12 }}>
        You'll need <b style={{ color: '#f0645f' }}>{needed}</b> questions total.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={create} style={{ flex: 1, padding: '10px' }}>CREATE</button>
        <button className="btn" onClick={() => setOpen(false)} style={{ padding: '10px' }}>CANCEL</button>
      </div>
    </div>
  )
}

// ---------- Quiz panel (questions + results) ----------
function QuizPanel({ quiz, questions, students, tab, setTab, onChange, onQuizChange }) {
  const link = `${window.location.origin}/quiz/${quiz.id}`
  const needed = quiz.num_students * quiz.questions_per_student
  const allowedTypes = (quiz.allowed_types && quiz.allowed_types.length) ? quiz.allowed_types : ALL_TYPES

  async function toggleOpen() {
    const { data } = await supabase.from('quizzes').update({ is_open: !quiz.is_open }).eq('id', quiz.id).select().single()
    if (data) onQuizChange(data)
  }
  async function copyLink() { await navigator.clipboard.writeText(link) }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1.2px', margin: '0 0 8px' }}>{quiz.title}</h1>
          <div className="label">
            {quiz.num_students} students · {quiz.questions_per_student} each · {quiz.duration_minutes} min · types: {allowedTypes.map((t) => t.toUpperCase()).join(', ')}
          </div>
        </div>
        <button className="btn" onClick={toggleOpen}
          style={{ background: quiz.is_open ? '#1f9d55' : '#fff', color: quiz.is_open ? '#fff' : '#131311', borderColor: quiz.is_open ? '#1f9d55' : '#131311' }}>
          {quiz.is_open ? 'OPEN ✓' : 'CLOSED'}
        </button>
      </div>

      {/* Share link */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '20px 0', flexWrap: 'wrap' }}>
        <code style={{ background: '#fff', border: '2px solid #131311', padding: '12px 14px', fontFamily: "'Space Mono',monospace", fontSize: 13 }}>{link}</code>
        <button className="btn" onClick={copyLink} style={{ padding: '12px 16px' }}>COPY LINK</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #131311', marginBottom: 24 }}>
        {['questions', 'results'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '12px 20px', border: 'none', cursor: 'pointer', fontFamily: "'Space Mono',monospace", fontSize: 13, letterSpacing: 1,
                     background: tab === t ? '#131311' : 'transparent', color: tab === t ? '#f2f1ec' : '#131311' }}>
            {t === 'questions' ? `QUESTIONS (${questions.length}/${needed})` : `RESULTS (${students.length})`}
          </button>
        ))}
      </div>

      {tab === 'questions'
        ? <QuestionsTab quiz={quiz} questions={questions} needed={needed} allowedTypes={allowedTypes} onChange={onChange} />
        : <ResultsTab students={students} onChange={onChange} />}
    </div>
  )
}

// ---------- Questions tab ----------
function QuestionsTab({ quiz, questions, needed, allowedTypes, onChange }) {
  const enough = questions.length >= needed
  return (
    <div>
      <div style={{ background: enough ? '#e6f6ee' : '#fdf0ef', border: `2px solid ${enough ? '#1f9d55' : '#e5322d'}`, padding: 14, marginBottom: 22, fontFamily: "'Space Mono',monospace", fontSize: 13 }}>
        {enough
          ? `✓ Enough questions. Every student gets a unique set of ${quiz.questions_per_student}.`
          : `Add ${needed - questions.length} more question(s). You need ${needed} for unique sets.`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30, alignItems: 'start' }}>
        <AddQuestion quizId={quiz.id} allowedTypes={allowedTypes} onChange={onChange} />
        <BulkAdd quizId={quiz.id} allowedTypes={allowedTypes} onChange={onChange} />
      </div>

      <div className="label" style={{ margin: '30px 0 12px' }}>Questions ({questions.length})</div>
      {questions.map((q, i) => (
        <div key={q.id} style={{ border: '1.5px solid #dddbd1', padding: 16, marginBottom: 10, background: '#fff', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, background: '#131311', color: '#fff', padding: '2px 7px', marginRight: 8 }}>{q.type.toUpperCase()}</span>
            <span style={{ fontWeight: 600 }}>{i + 1}. {q.prompt}</span>
            {q.type === 'mcq' && (
              <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: '#757064', marginTop: 6 }}>
                {(q.options || []).map((o) => `${o.key}) ${o.text}`).join('   ')} · correct: <b>{q.correct_key}</b>
              </div>
            )}
          </div>
          <button className="btn" style={{ padding: '6px 12px', height: 'fit-content' }}
            onClick={async () => { await supabase.from('questions').delete().eq('id', q.id); onChange() }}>✕</button>
        </div>
      ))}
    </div>
  )
}

function AddQuestion({ quizId, allowedTypes, onChange }) {
  const types = (allowedTypes && allowedTypes.length) ? allowedTypes : ALL_TYPES
  const [type, setType] = useState(types[0])
  const [prompt, setPrompt] = useState('')
  const [opts, setOpts] = useState({ A: '', B: '', C: '', D: '' })
  const [correct, setCorrect] = useState('A')
  const [points, setPoints] = useState(1)

  // keep the selected type valid if the allowed set changes
  useEffect(() => { if (!types.includes(type)) setType(types[0]) }, [allowedTypes]) // eslint-disable-line

  async function add() {
    if (!prompt.trim()) return
    const options = type === 'mcq'
      ? Object.entries(opts).filter(([, v]) => v.trim()).map(([key, text]) => ({ key, text: text.trim() }))
      : []
    const { error } = await supabase.from('questions').insert({
      quiz_id: quizId, type, prompt: prompt.trim(), options,
      correct_key: type === 'mcq' ? correct : null, points: parseInt(points) || 1,
    })
    if (error) { alert(error.message); return }
    setPrompt(''); setOpts({ A: '', B: '', C: '', D: '' }); onChange()
  }

  return (
    <div style={{ border: '2px solid #131311', padding: 18 }}>
      <div className="label" style={{ marginBottom: 12 }}>Add one question</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {types.map((t) => (
          <button key={t} onClick={() => setType(t)} className="btn" style={{ padding: '8px 12px', background: type === t ? '#e5322d' : 'transparent', color: type === t ? '#fff' : '#131311', borderColor: type === t ? '#e5322d' : '#131311' }}>{t.toUpperCase()}</button>
        ))}
      </div>
      <textarea className="field" placeholder="Question prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ minHeight: 70, marginBottom: 10 }} />
      {type === 'mcq' && ['A', 'B', 'C', 'D'].map((k) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input type="radio" name="correct" checked={correct === k} onChange={() => setCorrect(k)} title="Mark correct" />
          <span className="label" style={{ width: 14 }}>{k}</span>
          <input className="field" placeholder={`Option ${k}`} value={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.value })} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <span className="label">Points</span>
        <input className="field" type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} style={{ width: 80 }} />
        <button className="btn btn-primary" onClick={add} style={{ marginLeft: 'auto' }}>ADD →</button>
      </div>
    </div>
  )
}

function BulkAdd({ quizId, allowedTypes, onChange }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef(null)
  const template = 'type,prompt,option_a,option_b,option_c,option_d,correct,points\nmcq,"Capital of France?",Paris,London,Rome,Berlin,A,1\ntext,"Explain gravity.",,,,,,2\ncode,"Reverse a string in Python.",,,,,,3'

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result || '')); setMsg(`Loaded "${file.name}". Click Import.`) }
    reader.readAsText(file)
  }

  async function importAll() {
    const rows = csvToQuestions(text)
    if (!rows.length) { setMsg('No questions found — check the format.'); return }
    const allowed = new Set(allowedTypes && allowedTypes.length ? allowedTypes : ALL_TYPES)
    const kept = rows.filter((r) => allowed.has(r.type))
    const skipped = rows.length - kept.length
    if (!kept.length) { setMsg(`Skipped all ${rows.length} — this quiz only allows: ${[...allowed].join(', ')}.`); return }
    const payload = kept.map((r) => ({ quiz_id: quizId, ...r }))
    const { error } = await supabase.from('questions').insert(payload)
    if (error) { setMsg(error.message); return }
    setMsg(`Imported ${kept.length} question(s)${skipped ? ` · skipped ${skipped} (type not allowed here)` : ''}.`)
    setText(''); if (fileRef.current) fileRef.current.value = ''; onChange()
  }

  return (
    <div style={{ border: '2px solid #131311', padding: 18 }}>
      <div className="label" style={{ marginBottom: 12 }}>Bulk add questions</div>

      {/* File upload */}
      <label className="btn btn-primary" style={{ display: 'inline-block', marginBottom: 12 }}>
        CHOOSE CSV FILE
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
      </label>

      <p style={{ fontSize: 12, color: '#757064', marginTop: 0 }}>
        …or paste CSV below. First row = headers: type, prompt, option_a…d, correct (A/B/C/D), points.
      </p>
      <textarea className="field" style={{ minHeight: 130, fontFamily: "'Space Mono',monospace", fontSize: 12 }}
        placeholder={template} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={importAll}>IMPORT →</button>
        <button className="btn" onClick={() => setText(template)}>USE EXAMPLE</button>
      </div>
      {msg && <p style={{ fontSize: 12, color: '#c72620', marginTop: 8 }}>{msg}</p>}
    </div>
  )
}

// ---------- Results tab ----------
function ResultsTab({ students, onChange }) {
  async function reallow(id) {
    try { await rpc('teacher_reallow_student', { p_student_id: id }); onChange() }
    catch (e) { alert(e.message) }
  }
  const badge = (s) => {
    const map = { submitted: '#1f9d55', in_progress: '#e5a72d', registered: '#757064', blocked: '#e5322d' }
    return <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, color: '#fff', background: map[s.status] || '#757064', padding: '2px 8px' }}>{s.status.toUpperCase()}</span>
  }

  return (
    <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span className="label">{students.length} student(s) · updates automatically every few seconds</span>
      <button className="btn" style={{ padding: '8px 14px' }} onClick={onChange}>↻ REFRESH NOW</button>
    </div>
    {!students.length
      ? <p style={{ color: '#757064' }}>No students have started yet.</p>
      : <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #131311' }}>
            {['Student', 'Status', 'Score', 'Warnings', 'Recordings', ''].map((h) => (
              <th key={h} className="label" style={{ padding: '10px 8px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1.5px solid #dddbd1' }}>
              <td style={{ padding: '12px 8px' }}>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: '#757064' }}>{s.email}{s.student_id_txt ? ` · ${s.student_id_txt}` : ''}</div>
              </td>
              <td style={{ padding: '12px 8px' }}>{badge(s)}</td>
              <td style={{ padding: '12px 8px', fontFamily: "'Space Mono',monospace" }}>{s.score != null ? `${s.score}/${s.total_points}` : '—'}</td>
              <td style={{ padding: '12px 8px', fontFamily: "'Space Mono',monospace", color: s.warnings ? '#e5322d' : '#757064' }}>{s.warnings}</td>
              <td style={{ padding: '12px 8px' }}>
                {s.camera_url ? <a href={s.camera_url} target="_blank" rel="noreferrer">camera</a> : '—'}
                {s.screen_url ? <> · <a href={s.screen_url} target="_blank" rel="noreferrer">screen</a></> : ''}
              </td>
              <td style={{ padding: '12px 8px' }}>
                <button className="btn" style={{ padding: '6px 12px' }} onClick={() => reallow(s.id)}>RE-ALLOW</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>}
    </div>
  )
}
