import { supabase } from './supabase'

// Runs code by calling our Supabase edge function "run-code" (which executes
// it server-side via a free sandbox). langId is the editor language id (Monaco).
export async function runCode(langId, code) {
  const { data, error } = await supabase.functions.invoke('run-code', {
    body: { language: langId, code: code || '' },
  })
  if (error) throw new Error(error.message || 'Code runner is unavailable right now.')
  if (data?.error) throw new Error(data.error)
  return { output: data?.output ?? '(no output)' }
}
