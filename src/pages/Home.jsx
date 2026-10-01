import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Locky from '../components/Locky'

function introAllowed() {
  try {
    if (localStorage.getItem('ql_intro_seen') === '1') return false
  } catch (e) {}
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  } catch (e) {}
  return true
}

export default function Home() {
  const navigate = useNavigate()
  const animate = useRef(introAllowed()).current
  const [phase, setPhase] = useState(animate ? 'intro' : 'land')
  const [studentOpen, setStudentOpen] = useState(false)
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!animate) return
    try { localStorage.setItem('ql_intro_seen', '1') } catch (e) {}
    const t1 = setTimeout(() => setPhase('name'), 1700)
    const t2 = setTimeout(() => setPhase('land'), 2650)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [animate])

  function goStudent(e) {
    if (e) e.preventDefault()
    const v = link.trim()
    if (!v) return
    let id = v
    const m = v.match(/\/quiz\/([^/?#\s]+)/)
    if (m) id = m[1]
    navigate('/quiz/' + id)
  }

  return (
    <div className={`ql-home ${animate ? 'animate' : ''}`} data-phase={phase}>
      <style>{`
        .ql-home{position:relative;min-height:100vh;background:var(--bg);overflow:hidden;--ease:cubic-bezier(.65,0,.35,1);--back:cubic-bezier(.34,1.56,.64,1)}
        .ql-skip{position:absolute;top:22px;right:26px;z-index:9;border:1px solid var(--line);background:#fff;font-family:inherit;font-weight:600;font-size:12.5px;padding:7px 14px;border-radius:999px;cursor:pointer;color:var(--muted)}
        .ql-home[data-phase="land"] .ql-skip{display:none}

        .wm{position:absolute;left:50%;top:62%;display:flex;align-items:baseline;font-weight:900;font-size:46px;letter-spacing:-.02em;transform:translate(-50%,-50%) scale(1);transform-origin:left center;transition:all .85s var(--ease);z-index:8}
        .wm span{opacity:0;transform:translateY(12px);transition:opacity .4s var(--ease),transform .4s var(--ease)}
        .wm .dot{color:var(--accent)}
        .ql-home[data-phase="name"] .wm span,.ql-home[data-phase="land"] .wm span{opacity:1;transform:none}
        .ql-home[data-phase="land"] .wm{left:30px;top:24px;transform:translate(0,0) scale(.44)}

        .intro-ring{position:absolute;left:50%;top:42%;width:150px;height:150px;border:4px solid var(--accent);border-radius:50%;transform:translate(-50%,-50%) scale(.3);opacity:0;z-index:4}
        .ql-home.animate .intro-ring{animation:ringPulse .6s .4s both}
        @keyframes ringPulse{0%{opacity:.5;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}

        .introLocky{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);transition:left .9s var(--ease),top .9s var(--ease);z-index:6}
        .ql-home[data-phase="land"] .introLocky{left:74%;top:52%}
        .introLocky-inner{transform-origin:center bottom}
        .ql-home.animate .introLocky-inner{animation:lockIn .72s var(--back) both}
        @keyframes lockIn{0%{opacity:0;transform:translateY(-46px) scale(.5)}70%{opacity:1;transform:translateY(0) scale(1.06)}85%{transform:scale(.97)}100%{transform:scale(1)}}

        .hero{position:absolute;left:8%;top:50%;transform:translateY(-50%);max-width:450px;z-index:5}
        .hero .rise{opacity:0;transform:translateY(16px);transition:opacity .55s var(--ease),transform .55s var(--ease)}
        .ql-home[data-phase="land"] .hero .rise{opacity:1;transform:none}
        .ql-home[data-phase="land"] .hero .d2{transition-delay:.08s}
        .ql-home[data-phase="land"] .hero .d3{transition-delay:.16s}
        .hero h1{font-size:42px;line-height:1.08;font-weight:900;letter-spacing:-.03em;margin:0 0 14px}
        .hero p{font-size:15.5px;color:var(--muted);line-height:1.55;margin:0 0 24px}
        .cta{display:flex;gap:11px;flex-wrap:wrap;align-items:center}
        .qbtn{border:1px solid var(--line);background:#fff;font-family:inherit;font-weight:700;font-size:14.5px;padding:13px 24px;border-radius:12px;cursor:pointer;color:var(--ink)}
        .qbtn.p{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 2px 12px rgba(229,50,45,.28)}
        .slink{display:flex;gap:8px;margin-top:16px;max-width:430px}
        .slink input{flex:1;font-family:inherit;font-size:14px;border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:#fcfbf8}
        .slink input:focus{outline:0;border-color:var(--ink);background:#fff}
        .shint{font-size:12.5px;color:var(--muted);margin-top:8px}
        .slink-back{background:none;border:0;color:var(--muted);font-family:inherit;font-size:12.5px;cursor:pointer;margin-top:8px;padding:0}

        @media(max-width:860px){
          .introLocky{position:static;transform:none;margin:0 auto 10px}
          .ql-home[data-phase="land"] .introLocky{left:auto;top:auto}
          .wm{position:static;transform:scale(.5);transform-origin:left top;margin:18px 0 0 18px}
          .ql-home[data-phase="land"] .wm{position:static;transform:scale(.5)}
          .hero{position:static;transform:none;margin:4px auto 40px;padding:0 20px;text-align:center}
          .cta,.slink{justify-content:center}
          .intro-ring{display:none}
        }
      `}</style>

      {animate && phase !== 'land' && <button className="ql-skip" onClick={() => setPhase('land')}>Skip</button>}

      <div className="intro-ring"></div>

      <div className="introLocky">
        <div className="introLocky-inner">
          <Locky mood="idle" size={210} follow={phase === 'land'} />
        </div>
      </div>

      <div className="wm">
        {'QUIZLOCK'.split('').map((c, i) => (
          <span key={i} style={{ transitionDelay: (i * 55) + 'ms' }}>{c}</span>
        ))}
        <span className="dot" style={{ transitionDelay: '440ms' }}>.</span>
      </div>

      <div className="hero">
        <h1 className="rise">Give every student a fair exam.</h1>
        <p className="rise d2">Everyone gets their own set of questions. The screen locks during the test, and the camera, mic and screen record the whole time — so you can trust the result.</p>
        {!studentOpen ? (
          <div className="cta rise d3">
            <button className="qbtn p" onClick={() => navigate('/teacher/login')}>I'm a teacher →</button>
            <button className="qbtn" onClick={() => setStudentOpen(true)}>I'm a student</button>
          </div>
        ) : (
          <div className="rise d3">
            <form className="slink" onSubmit={goStudent}>
              <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the quiz link your teacher sent you" />
              <button className="qbtn p" type="submit" style={{ padding: '11px 20px' }}>Go →</button>
            </form>
            <div className="shint">It looks like <b>…/quiz/your-code</b> — paste the whole link or just the code.</div>
            <button className="slink-back" onClick={() => { setStudentOpen(false); setLink('') }}>← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
