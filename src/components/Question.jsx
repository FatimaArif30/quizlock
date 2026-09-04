// Renders one question. Supports: mcq, truefalse, text, code.
export default function Question({ q, value, onChange }) {
  if (q.type === 'truefalse') {
    return (
      <div role="radiogroup" aria-label="True or False" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {['True', 'False'].map((k) => {
          const selected = value === k
          return (
            <button key={k} role="radio" aria-checked={selected} onClick={() => onChange(k)}
              style={{ display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', padding: '20px 22px', cursor: 'pointer',
                border: selected ? '2px solid #131311' : '1.5px solid #dddbd1', background: selected ? '#131311' : '#fff', color: selected ? '#f2f1ec' : '#131311' }}>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 15, fontWeight: 700, color: selected ? '#e5322d' : '#a5a091' }}>{selected ? '●' : '○'}</span>
              <span style={{ fontSize: 22, fontWeight: selected ? 700 : 500 }}>{k}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (q.type === 'mcq') {
    const options = Array.isArray(q.options) ? q.options : []
    return (
      <div role="radiogroup" aria-label="Answer options" style={{ display: 'flex', flexDirection: 'column' }}>
        {options.map((opt, i) => {
          const selected = value === opt.key
          return (
            <button
              key={opt.key || i}
              role="radio"
              aria-checked={selected}
              aria-label={`Option ${opt.key}: ${opt.text}`}
              onClick={() => onChange(opt.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 20, textAlign: 'left',
                padding: selected ? '22px 18px' : '22px 4px',
                margin: selected ? '4px -18px' : 0,
                border: 'none', cursor: 'pointer',
                background: selected ? '#131311' : 'transparent',
                borderBottom: selected ? 'none' : '1.5px solid #dddbd1',
                color: selected ? '#f2f1ec' : '#131311',
              }}
            >
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 15, fontWeight: 700, width: 22, color: selected ? '#e5322d' : '#a5a091' }}>
                {opt.key}
              </span>
              <span style={{ fontSize: 22, fontWeight: selected ? 700 : 500 }}>{opt.text}</span>
              {selected && (
                <span style={{ marginLeft: 'auto', fontFamily: "'Space Mono',monospace", fontSize: 12, color: '#f0645f', letterSpacing: 1 }}>
                  SELECTED &rarr;
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  if (q.type === 'code') {
    return (
      <textarea
        className="field"
        style={{ fontFamily: "'Space Mono',monospace", minHeight: 260, lineHeight: 1.5, whiteSpace: 'pre', tabSize: 2 }}
        placeholder="// write your code here"
        spellCheck={false}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  // default: short/long text
  return (
    <textarea
      className="field"
      style={{ minHeight: 180, fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 18, lineHeight: 1.5 }}
      placeholder="Type your answer…"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
