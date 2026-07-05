import { useState } from 'react'
import { supabase } from './lib/supabase.js'

export default function Login() {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'crear'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [cargando, setCargando] = useState(false)

  async function entrarGoogle() {
    setError(null); setInfo(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(traducir(error.message))
  }

  async function enviar(e) {
    e.preventDefault()
    setError(null); setInfo(null); setCargando(true)
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setInfo('Cuenta creada. Si te pide confirmar el email, revisa tu correo y luego inicia sesión.')
          setModo('entrar')
        }
      }
    } catch (e) {
      setError(traducir(e.message))
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="login-wrap">
        <form className="card" onSubmit={enviar}>
          <div className="logo">
            <img src="/icon.png" alt="imputa.me" />
            <div className="name">imputa<span className="accent">.me</span></div>
            <div className="sub">{modo === 'entrar' ? 'Entra para ver tus horas' : 'Crea tu cuenta'}</div>
          </div>

          <button type="button" className="btn-google" onClick={entrarGoogle}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 12 2 2 12 2 24s10 22 22 22c11 0 21-8 21-22 0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.4 2 8 6.9 6.3 14.7z"/><path fill="#4CAF50" d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 36.8 26.9 38 24 38c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C8 41 15.4 46 24 46z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5C41.4 36.1 45 30.7 45 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
            Continuar con Google
          </button>

          <div className="divisor"><span>o con tu correo</span></div>

          <div className="field">
            <input type="email" inputMode="email" autoComplete="email" placeholder="Correo electrónico"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="Contraseña"
              autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <p className="msg err">{error}</p>}
          {info && <p className="msg ok">{info}</p>}

          <button className="btn-primary" type="submit" disabled={cargando} style={{ width: '100%', marginTop: 16 }}>
            {cargando ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
          </button>

          <p className="center-note">
            {modo === 'entrar' ? '¿Primera vez? ' : '¿Ya tienes cuenta? '}
            <button type="button" className="link-btn"
              onClick={() => { setModo(modo === 'entrar' ? 'crear' : 'entrar'); setError(null); setInfo(null) }}>
              {modo === 'entrar' ? 'Crear cuenta' : 'Iniciar sesión'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}

function traducir(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.'
  if (/already registered/i.test(msg)) return 'Ese correo ya tiene cuenta. Inicia sesión.'
  if (/at least 6/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.'
  return msg
}
