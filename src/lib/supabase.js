import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Helpful message during setup instead of a blank white screen.
  console.error(
    'Missing Supabase config. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'anon')

export const isConfigured = Boolean(url && anonKey)

// Small helper: call an RPC and normalise the { error } shape our
// database functions return into a thrown error.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  if (data && data.error) throw new Error(data.error)
  return data
}
