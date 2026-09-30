-- QuizLock upgrade v6
-- Dashboard visibility: record whether the report email was sent, and any error,
-- so the teacher dashboard can flag "email failed" per student.
alter table students add column if not exists report_emailed_at timestamptz;
alter table students add column if not exists report_email_error text;
