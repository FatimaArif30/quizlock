import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 44px', borderBottom: '2px solid #131311' }}>
        <span style={{ fontWeight: 800, fontSize: 21, letterSpacing: '-.6px' }}>
          QUIZLOCK<span style={{ color: '#e5322d' }}>.</span>
        </span>
        <Link to="/teacher/login" className="btn">TEACHER LOGIN &rarr;</Link>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 720 }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, letterSpacing: 2, color: '#757064', marginBottom: 16 }}>
            PROCTORED ONLINE EXAMS
          </div>
          <h1 style={{ fontSize: 60, lineHeight: 1.02, letterSpacing: '-2px', fontWeight: 800, margin: 0 }}>
            Fair exams, one question set per student.
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.5, color: '#3a352c', marginTop: 24, maxWidth: 560 }}>
            Every student gets a different set of questions. The screen locks during
            the test, and the camera, mic and screen are recorded the whole time.
          </p>
          <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
            <Link to="/teacher/login" className="btn btn-primary">I'M A TEACHER &rarr;</Link>
          </div>
          <p style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, color: '#757064', marginTop: 30, lineHeight: 1.6 }}>
            STUDENTS: open the exact link your teacher sent you.<br />
            It looks like <span style={{ color: '#131311' }}>&hellip;/quiz/&lt;code&gt;</span>
          </p>
        </div>
      </div>
    </div>
  )
}
