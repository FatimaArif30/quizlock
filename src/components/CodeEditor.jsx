import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { langByMonaco } from '../lib/languages'
import { runCode } from '../lib/runner'

// A VS Code-style editor (Monaco) with a Run button (Piston).
// Used by the student to write code, and by the teacher (read-only) to review it.
export default function CodeEditor({ langId, value, onChange, readOnly = false, height = 300 }) {
  const lang = langByMonaco(langId)
  const [out, setOut] = useState(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true); setOut('Running…')
    try { const r = await runCode(lang.monaco, value || ''); setOut(r.output) }
    catch (e) { setOut('Error: ' + e.message) }
    finally { setRunning(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="label">{lang.label}</span>
        <button className="btn btn-primary" style={{ padding: '6px 14px' }} disabled={running} onClick={run}>
          {running ? 'RUNNING…' : '▶ RUN'}
        </button>
      </div>
      <div style={{ border: '2px solid #131311' }}>
        <Editor
          height={`${height}px`}
          theme="vs-dark"
          language={lang.monaco}
          value={value || ''}
          onChange={(v) => onChange && onChange(v ?? '')}
          options={{ readOnly, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
        />
      </div>
      {out != null && (
        <pre style={{ background: '#0d1117', color: '#e6edf3', padding: 12, marginTop: 8, whiteSpace: 'pre-wrap', fontFamily: "'Space Mono',monospace", fontSize: 13, maxHeight: 220, overflow: 'auto' }}>{out}</pre>
      )}
    </div>
  )
}
