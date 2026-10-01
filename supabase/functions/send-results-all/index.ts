// QuizLock — send-results-all
// Teacher-triggered. Emails each submitted student their result:
// score, pass/fail, and a per-question breakdown (right/wrong + marks).
//
// Called two ways from the dashboard:
//   { quiz_id }                      -> "Email all": only students NOT emailed yet
//   { quiz_id, student_id }          -> one student, always (re)send
//
// Deploy WITH jwt verification (default) so only a logged-in teacher can call it;
// we additionally check the quiz belongs to that teacher.
//
// Secrets (already set for send-report-email): RESEND_API_KEY, EMAIL_FROM.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { quiz_id, student_id } = await req.json()
    if (!quiz_id) return json({ error: 'quiz_id required' }, 400)

    const URL = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // who is calling? (verify the JWT the dashboard sent)
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const { data: quiz } = await admin.from('quizzes').select('*').eq('id', quiz_id).single()
    if (!quiz) return json({ error: 'quiz_not_found' }, 404)
    if (quiz.teacher_id !== user.id) return json({ error: 'not_allowed' }, 403)

    // gather recipients
    let q = admin.from('students').select('*').eq('quiz_id', quiz_id).eq('status', 'submitted')
    if (student_id) q = q.eq('id', student_id)
    const { data: all } = await q
    let students = all || []
    // "Email all" (no student_id) => only those not emailed yet
    if (!student_id) students = students.filter((s: any) => !s.results_emailed_at)
    students = students.filter((s: any) => s.email)

    let sent = 0, failed = 0
    const errors: string[] = []
    for (const s of students) {
      const { data: ans } = await admin.from('answers')
        .select('awarded,is_correct,response,questions(prompt,type,points,correct_key)')
        .eq('student_id', s.id)
      const html = buildHtml(quiz, s, ans || [])
      const subj = `Your result for "${quiz.title}"`
      const err = await sendEmail(s.email, subj, html)
      await admin.from('students').update({
        results_emailed_at: err ? null : new Date().toISOString(),
        results_email_error: err,
      }).eq('id', s.id)
      if (err) { failed++; errors.push(`${s.name || s.email}: ${err}`) } else { sent++ }
    }
    return json({ ok: failed === 0, sent, failed, considered: students.length, errors: errors.slice(0, 20) })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function buildHtml(quiz: any, s: any, ans: any[]): string {
  const total = s.total_points
  const pct = total ? Math.round((s.score / total) * 100) : null
  const hasPass = quiz.pass_score != null
  const passed = hasPass && pct != null ? pct >= quiz.pass_score : null
  const scoreLine = s.score != null && total != null
    ? `${esc(s.score)} / ${esc(total)}${pct != null ? ` (${pct}%)` : ''}` : '—'
  const passBadge = passed == null ? '' :
    `<span style="display:inline-block;padding:3px 12px;border-radius:999px;font-weight:700;font-size:13px;color:#fff;background:${passed ? '#1f9d55' : '#e5322d'}">${passed ? 'PASSED' : 'NOT PASSED'}</span>`

  const rows = ans.map((a) => {
    const qd = a.questions || {}
    const auto = qd.type === 'mcq' || qd.type === 'truefalse'
    const earned = auto ? (a.is_correct ? (qd.points || 0) : 0) : (a.awarded ?? 0)
    const correct = auto ? !!a.is_correct : ((a.awarded ?? 0) > 0)
    const mark = correct
      ? `<span style="color:#1f9d55;font-weight:700">✓</span>`
      : `<span style="color:#e5322d;font-weight:700">✗</span>`
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${mark}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(qd.prompt)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${esc(earned)} / ${esc(qd.points ?? 0)}</td>
    </tr>`
  }).join('')

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#131311;max-width:640px">
      <h2 style="margin:0 0 4px">Your result — ${esc(quiz.title)}</h2>
      <p style="margin:0 0 16px;color:#666">Hi ${esc(s.name || 'student')}, here is your result.</p>
      <div style="padding:16px 18px;border:1px solid #e6e4dc;border-radius:12px;margin-bottom:18px">
        <div style="font-size:26px;font-weight:800;letter-spacing:-.5px">${scoreLine}</div>
        <div style="margin-top:8px">${passBadge}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #131311;width:28px"></th>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #131311">Question</th>
          <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #131311">Marks</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:10px;color:#999">No answers recorded.</td></tr>'}</tbody>
      </table>
    </div>`
}

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') || 'QuizLock <onboarding@resend.dev>',
        to: [to], subject, html,
      }),
    })
    if (!res.ok) { const t = await res.text(); return `HTTP ${res.status}: ${t.slice(0, 200)}` }
    return null
  } catch (e) { return String(e) }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
