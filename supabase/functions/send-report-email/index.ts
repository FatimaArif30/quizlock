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

    // Bucket is private — create signed links (valid 30 days) from the stored paths.
    const sign = async (path: string | null) => {
      if (!path) return null
      const { data } = await admin.storage.from('recordings').createSignedUrl(path, 60 * 60 * 24 * 30)
      return data?.signedUrl ?? null
    }
    const camUrl = await sign(student.camera_url)
    const scrUrl = await sign(student.screen_url)

    const links = [
      camUrl ? `<p>Camera recording: <a href="${camUrl}">watch</a></p>` : '',
      scrUrl ? `<p>Screen recording: <a href="${scrUrl}">watch</a></p>` : '',
    ].join('')

    const scoreLine = student.score != null
      ? `<p><b>Score:</b> ${student.score} / ${student.total_points}</p>` : ''

    const studentHtml = `
      <div style="font-family:sans-serif">
        <h2>Your QuizLock submission</h2>
        <p>Quiz: <b>${quiz.title}</b></p>
        <p>Hi ${student.name}, your quiz was submitted. Your recording is linked below.</p>
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
