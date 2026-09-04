// QuizLock — run-code
// Runs a student's code via the free Paiza.IO API, server-side (no browser
// CORS, no API key needed). Called from the code editor's RUN button.
// Deploy with:  supabase functions deploy run-code --no-verify-jwt

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// our editor language id (Monaco) -> Paiza language id
const MAP: Record<string, string> = {
  python: 'python3', javascript: 'javascript', java: 'java', c: 'c', cpp: 'cpp',
  csharp: 'csharp', go: 'go', ruby: 'ruby', php: 'php', rust: 'rust',
  kotlin: 'kotlin', swift: 'swift', shell: 'bash', sql: 'mysql',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PAIZA = 'https://api.paiza.io/runners'
const KEY = 'guest'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { language, code } = await req.json()
    const lang = MAP[language] || 'python3'

    // 1) create the run
    const createBody = new URLSearchParams({ source_code: code || '', language: lang, input: '', api_key: KEY })
    const cr = await fetch(`${PAIZA}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody,
    })
    const created = await cr.json()
    if (created.error) return json({ output: `Runner error: ${created.error}` })
    if (!created.id) return json({ output: 'Could not start the runner. Please try again.' })

    // 2) poll until finished
    let status = created.status
    for (let i = 0; i < 25 && status !== 'completed'; i++) {
      await sleep(700)
      const s = await fetch(`${PAIZA}/get_status?id=${created.id}&api_key=${KEY}`)
      const sj = await s.json()
      status = sj.status
    }

    // 3) fetch output
    const d = await fetch(`${PAIZA}/get_details?id=${created.id}&api_key=${KEY}`)
    const dj = await d.json()
    const output = [dj.build_stderr, dj.stdout, dj.stderr].filter(Boolean).join('\n') || '(no output)'
    return json({ output })
  } catch (e) {
    return json({ output: 'Error: ' + String(e) }, 200)
  }
})
