// Runs code through the free public Piston service (executes ~40+ languages
// in a server-side sandbox, so nothing runs on our side). It can rate-limit
// under heavy load; if that matters later, Piston can be self-hosted.
const PISTON = 'https://emkc.org/api/v2/piston'
let runtimesCache = null

async function getRuntimes() {
  if (runtimesCache) return runtimesCache
  const r = await fetch(`${PISTON}/runtimes`)
  runtimesCache = await r.json()
  return runtimesCache
}

// pistonLang: a language id or alias (e.g. "python", "c++", "bash")
export async function runCode(pistonLang, code) {
  if (!pistonLang) throw new Error('This question has no runnable language set.')
  const runtimes = await getRuntimes()
  const rt = runtimes.find(
    (r) => r.language === pistonLang || (r.aliases || []).includes(pistonLang)
  )
  if (!rt) throw new Error(`"${pistonLang}" can't be run here.`)

  const res = await fetch(`${PISTON}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: rt.language, version: rt.version, files: [{ content: code || '' }] }),
  })
  const data = await res.json()
  if (data.message) throw new Error(data.message) // e.g. rate limited
  const run = data.run || {}
  const output = [run.stdout, run.stderr].filter(Boolean).join('\n')
  return { output: output || '(no output)', exitCode: run.code }
}
