// QuizLock — send-report-email
// Supabase Edge Function. Emails the recording links + score to the
// student and the teacher when a quiz is submitted.
//
// Secrets it needs (set with `supabase secrets set`):
//   RESEND_API_KEY   — from https://resend.com
//   EMAIL_FROM       — e.g. "QuizLock <onboarding@resend.dev>"
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { student_id, token } = await req.json()
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // verify the student + token
    const { data: student } = await admin
      .from('students').select('*').eq('id', student_id).eq('token', token).single()
    if (!student) return json({ error: 'bad_token' }, 401)

    const { data: quiz } = await admin
      .from('quizzes').select('*').eq('id', student.quiz_id).single()
    const { data: teacher } = await admin.auth.admin.getUserById(quiz.teacher_id)
    const teacherEmail = teacher?.user?.email

    // Bucket is private — create signed links (valid 7 days) from the stored paths.
    const camUrls = await signRecording(admin, student.camera_url)
    const scrUrls = await signRecording(admin, student.screen_url)
    const hasLinks = camUrls.length > 0 || scrUrls.length > 0

    const links = hasLinks
      ? linkLine('Camera recording', camUrls) + linkLine('Screen recording', scrUrls) +
        `<p style="color:#67625a;font-size:12px">Recording links work for 7 days.</p>`
      : ''

    const scoreLine = student.score != null
      ? `<p><b>Score:</b> ${student.score} / ${student.total_points}</p>` : ''

    const studentHtml = `
      <div style="font-family:sans-serif">
        <h2>Your QuizLock submission</h2>
        <p>Quiz: <b>${quiz.title}</b></p>
        <p>Hi ${student.name}, your quiz was submitted.${hasLinks ? ' Your recording is linked below.' : ''}</p>
        ${links}
      </div>`

    const teacherHtml = `
      <div style="font-family:sans-serif">
        <h2>New quiz submission — ${quiz.title}</h2>
        <p><b>Student:</b> ${student.name} (${student.email})${student.student_id_txt ? ' · ID ' + student.student_id_txt : ''}</p>
        ${scoreLine}
        <p><b>Warnings:</b> ${student.warnings}${student.submit_reason ? ' · reason: ' + student.submit_reason : ''}</p>
        ${links}
      </div>`

    const errs: string[] = []
    const e1 = await sendEmail(student.email, `Your quiz "${quiz.title}" was submitted`, studentHtml)
    if (e1) errs.push(`student: ${e1}`)
    if (teacherEmail) {
      const e2 = await sendEmail(teacherEmail, `Submission: ${student.name} — ${quiz.title}`, teacherHtml)
      if (e2) errs.push(`teacher: ${e2}`)
    }
    const emailError = errs.length ? errs.join(" | ").slice(0, 500) : null

    // Record status so the teacher dashboard can flag a failed email.
    await admin.from("students").update({
      report_emailed_at: emailError ? null : new Date().toISOString(),
      report_email_error: emailError,
    }).eq("id", student_id)

    return json({ ok: !emailError, email_error: emailError })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

// How long emailed recording links stay valid.
const LINK_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

// A stored recording value is either a single older file ("…/camera-123.webm")
// or, since live segmented recording, a folder of ~45-second clips
// ("<studentId>/<attemptId>/camera"). Returns signed links in playback order,
// or [] if nothing was uploaded.
// deno-lint-ignore no-explicit-any
async function signRecording(admin: any, stored: string | null): Promise<string[]> {
  if (!stored) return []
  const bucket = admin.storage.from('recordings')
  if (/\.webm$/i.test(stored)) {
    const { data } = await bucket.createSignedUrl(stored, LINK_TTL_SECONDS)
    return data?.signedUrl ? [data.signedUrl] : []
  }
  const { data: files } = await bucket.list(stored, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  const paths = (files || [])
    .filter((f: { name: string }) => /\.webm$/i.test(f.name))
    .map((f: { name: string }) => `${stored}/${f.name}`)
    .sort()
  if (!paths.length) return []
  const { data: signed } = await bucket.createSignedUrls(paths, LINK_TTL_SECONDS)
  return (signed || []).map((s: { signedUrl: string | null }) => s.signedUrl).filter(Boolean) as string[]
}

// One line per stream: a single "watch" link, or numbered parts in order.
function linkLine(label: string, urls: string[]): string {
  if (!urls.length) return ''
  if (urls.length === 1) return `<p>${label}: <a href="${urls[0]}">watch</a></p>`
  const parts = urls.map((u, i) => `<a href="${u}">${i + 1}</a>`).join(' · ')
  return `<p>${label} — ${urls.length} parts of about 45 seconds each, watch in order: ${parts}</p>`
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
    if (!res.ok) {
      const t = await res.text()
      console.error('Resend error', t)
      return `HTTP ${res.status}: ${t.slice(0, 200)}`
    }
    return null
  } catch (e) {
    console.error('Resend threw', e)
    return String(e)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
