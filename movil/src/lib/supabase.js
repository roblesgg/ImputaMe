import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && anonKey)

if (!supabaseConfigurado) {
  console.warn(
    '[imputa.me] Falta configurar Supabase. Copia .env.example a .env y rellena ' +
      'VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = supabaseConfigurado ? createClient(url, anonKey) : null
