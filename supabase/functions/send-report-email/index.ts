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

    const links = [
      student.camera_url ? `<p>Camera recording: <a href="${student.camera_url}">${student.camera_url}</a></p>` : '',
      student.screen_url ? `<p>Screen recording: <a href="${student.screen_url}">${student.screen_url}</a></p>` : '',
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

    await sendEmail(student.email, `Your quiz "${quiz.title}" was submitted`, studentHtml)
    if (teacherEmail) await sendEmail(teacherEmail, `Submission: ${student.name} — ${quiz.title}`, teacherHtml)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

async function sendEmail(to: string, subject: string, html: string) {
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
  if (!res.ok) console.error('Resend error', await res.text())
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
