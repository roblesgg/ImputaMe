import { useEffect, useState } from 'react'
import { supabase, supabaseConfigurado } from './lib/supabase.js'
import Login from './Login.jsx'
import TimerApp from './TimerApp.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!supabaseConfigurado) {
      setCargando(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigurado) {
    return (
      <div className="app-shell">
        <div className="login-wrap">
          <div className="card">
            <p className="center-note">
              Falta configurar Supabase. Copia <b>.env.example</b> a <b>.env</b> y rellena
              tus claves (Supabase → Project Settings → API).
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (cargando) {
    return <div className="app-shell"><p className="spin">Cargando…</p></div>
  }

  if (!session) return <Login />
  return <TimerApp session={session} />
}
