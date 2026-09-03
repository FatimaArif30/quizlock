// Renders one question. Supports all three types: mcq, text, code.
export default function Question({ q, value, onChange }) {
  if (q.type === 'mcq') {
    const options = Array.isArray(q.options) ? q.options : []
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {options.map((opt, i) => {
          const selected = value === opt.key
          return (
            <button
              key={opt.key || i}
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
