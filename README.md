# QuizLock

A proctored online quiz portal.

- **Unique questions** — each student gets a different set (no overlap).
- **Lockdown** — fullscreen, blocks tab-switching/copy-paste; one warning then auto-submit.
- **Recording** — camera + mic + screen recorded the whole time, emailed to student + teacher.
- **One attempt** — a student can't retake; the teacher can re-allow.

Built with React + Vite + Tailwind, Supabase (database + video storage + login), and Resend (email).

> **Laptops/desktops only.** Full lockdown and screen recording do not work on phones — that's a browser limit, not a bug.

---

## What you need (all free)
1. **Node.js** installed (https://nodejs.org — the "LTS" version).
2. A free **Supabase** account — https://supabase.com
3. A free **Resend** account — https://resend.com (for sending emails)
4. Later, a free **Vercel** account — https://vercel.com (to put it online)

---

## 1. Install the project
Open a terminal **inside this folder** and run:
```
npm install
```

## 2. Create your Supabase project
1. Go to https://supabase.com → **New project**. Pick any name + password.
2. When it's ready, open **SQL Editor → New query**.
3. Open the file `supabase/schema.sql` from this folder, copy **everything**, paste it, and click **Run**. This builds all the tables and rules.
4. Go to **Project Settings → API**. Copy two things:
   - **Project URL**
   - **anon public** key

## 3. Add your keys
1. In this folder, make a copy of `.env.example` and name it **`.env`**.
2. Paste your values:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## 4. Run it on your computer
```
npm run dev
```
Open the link it prints (usually http://localhost:5173).
- Click **Teacher login → Sign up**, make an account.
  - *(Tip: in Supabase → Authentication → Providers → Email, turn OFF "Confirm email" while testing, so you can log in right away.)*
- Create a quiz, add questions (type them or paste the CSV — see `questions-template.csv`).
- Copy the quiz link and open it in another tab to test as a student.

## 5. Turn on emails (Resend)
Emails are sent by a small Supabase "Edge Function".
1. Make a free account at https://resend.com and create an **API key**.
2. Install the Supabase CLI: https://supabase.com/docs/guides/cli (or `npm i -g supabase`).
3. In this folder:
```
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set RESEND_API_KEY=your-resend-key EMAIL_FROM="QuizLock <onboarding@resend.dev>"
supabase functions deploy send-report-email
```
> Until you verify your own domain in Resend, emails send from `onboarding@resend.dev` and may only reach your own address. That's fine for testing.

## 6. Put it online (Vercel)
1. Push this folder to a GitHub repo (or use `vercel` CLI).
2. On https://vercel.com → **New Project** → import it.
3. Add the two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in Vercel settings.
4. Deploy. Your live link works for students anywhere.

---

## How the pieces fit
```
Student browser ──► Supabase RPC functions ──► Postgres (questions, answers, students)
       │                                         (correct answers never sent to browser)
       ├─► Supabase Storage  (camera + screen videos)
       └─► Edge Function "send-report-email" ─► Resend ─► emails to student + teacher
Teacher browser ─► Supabase (login) ─► dashboard (build quiz, see results + videos)
```

## Folder map
```
src/
  pages/        Home, TeacherLogin, TeacherDashboard, QuizFlow (student)
  components/   Timer, Question, CameraPreview
  hooks/        useProctoring (lockdown), useRecorder (camera/mic/screen)
  lib/          supabase client
supabase/
  schema.sql    all tables, security, and the grading / unique-assignment logic
  functions/send-report-email/   the email sender
```

## Good to know
- **Privacy:** the `recordings` storage bucket is **public** (anyone with the exact link can view a video). Simple for v1. Ask if you want private signed links instead.
- **Grading:** multiple-choice is graded automatically. Text/code answers are saved for you to read and grade by hand in the results tab (coming next).
- **Unique sets:** if you have more students than questions allow, a student is told there aren't enough questions — add more.

## Next steps we can add
- Manual grading UI for text/code answers
- Private (signed) video links
- Downloadable results (CSV)
- Question bank reuse across quizzes
