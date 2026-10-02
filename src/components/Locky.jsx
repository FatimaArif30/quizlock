import { useEffect, useRef } from 'react'

// QuizLock mascot. One SVG, a few moods, all in ink + red.
// <Locky mood="idle|happy|wink|think" size={120} follow celebrate />
let _cssInjected = false
const LOCKY_CSS = `
.locky{overflow:visible;display:block}
.locky .body-g{transform-box:fill-box;transform-origin:center bottom;animation:lk-bob 2.8s ease-in-out infinite}
@keyframes lk-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.locky.lk-cheer .body-g{animation:lk-cheer .6s ease}
@keyframes lk-cheer{0%{transform:translateY(0)}30%{transform:translateY(-22px)}60%{transform:translateY(0)}80%{transform:translateY(-6px)}100%{transform:translateY(0)}}
.locky .eyeLid{transform-box:fill-box;transform-origin:center;animation:lk-blink 4.4s infinite}
@keyframes lk-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
.locky .armWaveR{transform-box:fill-box;transform-origin:top center;animation:lk-wave 2s ease-in-out infinite}
@keyframes lk-wave{0%,100%{transform:rotate(8deg)}50%{transform:rotate(-26deg)}}
.locky .m-happy,.locky .m-think,.locky .armChinR,.locky .armUpL,.locky .armUpR,.locky .browTh,.locky .winkLine,.locky .spark{display:none}
.locky[data-mood="happy"] .m-idle{display:none}.locky[data-mood="happy"] .m-happy{display:block}
.locky[data-mood="think"] .m-idle{display:none}.locky[data-mood="think"] .m-think{display:block}
.locky[data-mood="think"] .armWaveR{display:none}.locky[data-mood="think"] .armChinR{display:block}.locky[data-mood="think"] .browTh{display:block}
.locky[data-mood="happy"] .armWaveR,.locky[data-mood="happy"] .armDownL{display:none}
.locky[data-mood="happy"] .armUpL,.locky[data-mood="happy"] .armUpR{display:block}
.locky[data-mood="wink"] .eyeR,.locky[data-mood="wink"] .pupR{display:none}
.locky[data-mood="wink"] .winkLine{display:block}
.locky.lk-cheer .spark{display:block;animation:lk-spk .6s ease both}
@keyframes lk-spk{0%{opacity:0;transform:scale(.4)}50%{opacity:1}100%{opacity:0;transform:scale(1.3)}}
@media (prefers-reduced-motion: reduce){
  .locky .body-g,.locky .eyeLid,.locky .armWaveR{animation:none}
}
`

export default function Locky({ mood = 'idle', size = 120, follow = false, celebrate = false, className = '', style }) {
  const ref = useRef(null)

  useEffect(() => {
    if (_cssInjected || typeof document === 'undefined') return
    const s = document.createElement('style'); s.id = 'locky-css'; s.textContent = LOCKY_CSS
    document.head.appendChild(s); _cssInjected = true
  }, [])

  useEffect(() => {
    if (!follow) return
    const svg = ref.current; if (!svg) return
    const pL = svg.querySelector('.pupL'), pR = svg.querySelector('.pupR')
    if (!pL || !pR) return
    const baseL = { x: 90, y: 140 }, baseR = { x: 130, y: 140 }
    const onMove = (e) => {
      const r = svg.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.55
      const a = Math.atan2(e.clientY - cy, e.clientX - cx)
      const d = Math.min(4.5, Math.hypot(e.clientX - cx, e.clientY - cy) / 40)
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d
      pL.setAttribute('cx', baseL.x + dx); pL.setAttribute('cy', baseL.y + dy)
      pR.setAttribute('cx', baseR.x + dx); pR.setAttribute('cy', baseR.y + dy)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [follow])

  return (
    <svg ref={ref} className={`locky ${celebrate ? 'lk-cheer' : ''} ${className}`} data-mood={celebrate ? 'happy' : mood}
      width={size} height={size} viewBox="0 0 220 230" style={style} role="img" aria-label="Locky the QuizLock mascot">
      <g className="body-g">
        <g className="spark"><path d="M40 60 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#d92d28" /></g>
        <g className="spark" style={{ animationDelay: '.08s' }}><path d="M182 54 l2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5z" fill="#131311" /></g>
        <g className="spark" style={{ animationDelay: '.16s' }}><circle cx="176" cy="150" r="4" fill="#d92d28" /></g>

        <path d="M74 104 V80 a36 36 0 0 1 72 0 V104" fill="none" stroke="#131311" strokeWidth="13" strokeLinecap="round" />
        <g className="armUpL"><rect x="40" y="96" width="11" height="34" rx="5.5" fill="#131311" transform="rotate(32 45 113)" /></g>
        <g className="armUpR"><rect x="169" y="96" width="11" height="34" rx="5.5" fill="#131311" transform="rotate(-32 175 113)" /></g>

        <rect x="50" y="100" width="120" height="100" rx="26" fill="#131311" />

        <g className="eyeLid">
          <ellipse className="eyeL" cx="90" cy="138" rx="13" ry="14" fill="#f2f1ec" />
          <ellipse className="eyeR" cx="130" cy="138" rx="13" ry="14" fill="#f2f1ec" />
        </g>
        <circle className="pupL" cx="90" cy="140" r="5.5" fill="#131311" />
        <circle className="pupR" cx="130" cy="140" r="5.5" fill="#131311" />
        <path className="winkLine" d="M120 139 q10 7 20 0" fill="none" stroke="#f2f1ec" strokeWidth="4.5" strokeLinecap="round" />
        <path className="browTh" d="M80 124 q10 -5 20 -1" fill="none" stroke="#f2f1ec" strokeWidth="4" strokeLinecap="round" />

        <path className="m-idle" d="M96 162 q14 12 28 0" fill="none" stroke="#f2f1ec" strokeWidth="4.5" strokeLinecap="round" />
        <path className="m-happy" d="M92 158 q18 22 36 0 q-18 8 -36 0z" fill="#f2f1ec" />
        <circle className="m-think" cx="110" cy="166" r="5" fill="#f2f1ec" />

        <circle cx="110" cy="184" r="7.5" fill="#d92d28" /><path d="M110 184 l-5.5 13 h11 z" fill="#d92d28" />

        <g className="armDownL"><rect x="40" y="132" width="11" height="30" rx="5.5" fill="#131311" /></g>
        <g className="armWaveR"><rect x="169" y="120" width="11" height="34" rx="5.5" fill="#131311" /><circle cx="174.5" cy="118" r="7" fill="#131311" /></g>
        <g className="armChinR"><rect x="150" y="150" width="11" height="26" rx="5.5" fill="#131311" transform="rotate(-54 155 163)" /></g>

        <ellipse cx="84" cy="206" rx="13" ry="7.5" fill="#131311" />
        <ellipse cx="136" cy="206" rx="13" ry="7.5" fill="#131311" />
      </g>
    </svg>
  )
}
