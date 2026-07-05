import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { supabase } from './lib/supabase.js'
import Calendario from './Calendario.jsx'

const esNativo = Capacitor.isNativePlatform()

const COLORES = ['#6366f1', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#2dd4bf']

function inicioDelDiaMs() {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Parser de una línea CSV respetando comillas (la tarea va entre comillas).
function parseCSVLine(line) {
  const out = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
      else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"') inQ = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

function formatDuracion(seg) {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function TimerApp({ session }) {
  const [tareas, setTareas] = useState([])
  const [fichajes, setFichajes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState('')
  const [now, setNow] = useState(Date.now())
  const [importMsg, setImportMsg] = useState(null)
  const [vista, setVista] = useState('tareas')
  const fileRef = useRef(null)
  const inicioDia = useRef(inicioDelDiaMs())

  const cargar = useCallback(async () => {
    const desde = inicioDia.current
    const [t, f] = await Promise.all([
      supabase.from('tareas').select('*').order('creado_en', { ascending: true }),
      supabase.from('fichajes').select('*').or(`fin_ms.is.null,fin_ms.gte.${desde}`),
    ])
    if (!t.error) setTareas(t.data)
    if (!f.error) setFichajes(f.data)
    setCargando(false)
  }, [])

  // Carga inicial + suscripción en vivo (sync con el PC)
  useEffect(() => {
    cargar()
    const canal = supabase
      .channel('imputame-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas' }, cargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fichajes' }, cargar)
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [cargar])

  // Tic cada segundo para el contador en vivo
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const abierto = fichajes.find((f) => f.fin_ms == null) || null
  const activaId = abierto ? abierto.tarea_id : null

  function segundosHoy(tareaId) {
    let total = 0
    for (const f of fichajes) {
      if (f.tarea_id !== tareaId) continue
      const fin = f.fin_ms ?? now
      const desde = Math.max(f.inicio_ms, inicioDia.current)
      total += Math.max(0, fin - desde)
    }
    return Math.floor(total / 1000)
  }
  const totalHoy = tareas.reduce((s, t) => s + segundosHoy(t.id), 0)

  // Permiso de notificaciones (solo en la app nativa Android)
  useEffect(() => {
    if (esNativo) LocalNotifications.requestPermissions().catch(() => {})
  }, [])

  // Notificación en la barra con la tarea activa y su tiempo (refresco ~30s).
  const ultimaNotif = useRef(0)
  useEffect(() => {
    if (!esNativo) return
    const activa = tareas.find((t) => t.id === activaId)
    if (!activa) {
      LocalNotifications.cancel({ notifications: [{ id: 1 }] }).catch(() => {})
      ultimaNotif.current = 0
      return
    }
    if (Date.now() - ultimaNotif.current < 30000) return
    ultimaNotif.current = Date.now()
    LocalNotifications.schedule({
      notifications: [{
        id: 1,
        title: `⏱ ${activa.nombre}`,
        body: `${formatDuracion(segundosHoy(activa.id))} hoy · en curso`,
        ongoing: true,
        autoCancel: false,
      }],
    }).catch(() => {})
  }, [activaId, now, tareas]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pausarActiva() {
    if (!abierto) return
    await supabase.from('fichajes').update({ fin_ms: Date.now() }).eq('id', abierto.id)
  }

  async function alternar(tareaId) {
    if (activaId === tareaId) {
      await pausarActiva()
    } else {
      await pausarActiva()
      await supabase.from('fichajes').insert({ tarea_id: tareaId, inicio_ms: Date.now(), fin_ms: null })
    }
    cargar()
  }

  // Importa el CSV que exporta la app de escritorio (Fecha,Tarea,Segundos,Horas).
  // Reutiliza tareas por nombre y crea un fichaje por fila (día a las 09:00 + duración).
  async function importarCSV(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportMsg('Importando…')
    try {
      const text = await file.text()
      const lineas = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const desde = lineas[0] && lineas[0].toLowerCase().startsWith('fecha') ? 1 : 0
      const filas = []
      for (let i = desde; i < lineas.length; i++) {
        const c = parseCSVLine(lineas[i])
        const fecha = (c[0] || '').trim()
        const nom = (c[1] || '').trim()
        const secs = parseInt(c[2], 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !nom || !Number.isFinite(secs) || secs <= 0) continue
        filas.push({ fecha, nom, secs })
      }
      if (!filas.length) { setImportMsg('No encontré filas válidas (formato: Fecha,Tarea,Segundos,Horas).'); return }

      const existentes = new Map(tareas.map((t) => [t.nombre, t.id]))
      const nuevosNombres = [...new Set(filas.map((f) => f.nom).filter((n) => !existentes.has(n)))]
      if (nuevosNombres.length) {
        const nuevas = nuevosNombres.map((n, i) => ({ nombre: n, color: COLORES[(tareas.length + i) % COLORES.length] }))
        const { data, error } = await supabase.from('tareas').insert(nuevas).select('id,nombre')
        if (error) throw error
        data.forEach((t) => existentes.set(t.nombre, t.id))
      }

      const nuevosFichajes = filas
        .map((f) => {
          const ini = new Date(f.fecha + 'T09:00:00').getTime()
          return { tarea_id: existentes.get(f.nom), inicio_ms: ini, fin_ms: ini + f.secs * 1000 }
        })
        .filter((x) => x.tarea_id)

      for (let i = 0; i < nuevosFichajes.length; i += 500) {
        const { error } = await supabase.from('fichajes').insert(nuevosFichajes.slice(i, i + 500))
        if (error) throw error
      }
      setImportMsg(`✓ Importado: ${nuevosFichajes.length} registros · ${nuevosNombres.length} tareas nuevas.`)
      cargar()
    } catch (err) {
      setImportMsg('Error al importar: ' + (err.message || err))
    }
  }

  async function anadirTarea(e) {
    e.preventDefault()
    const n = nombre.trim()
    if (!n) return
    const color = COLORES[tareas.length % COLORES.length]
    setNombre('')
    await supabase.from('tareas').insert({ nombre: n, color })
    cargar()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <img src="/icon.png" alt="" />
        <span className="brand">imputa<span className="accent">.me</span></span>
        <span className="spacer" />
        <button className="icon-btn" title="Importar CSV" onClick={() => fileRef.current?.click()}>📥</button>
        <button className="icon-btn" title="Cerrar sesión" onClick={() => supabase.auth.signOut()}>⎋</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={importarCSV} />
      </header>

      {importMsg && (
        <div className="import-msg" onClick={() => setImportMsg(null)}>{importMsg}</div>
      )}

      <div className="tabs">
        <button className={`tab${vista === 'tareas' ? ' on' : ''}`} onClick={() => setVista('tareas')}>Tareas</button>
        <button className={`tab${vista === 'calendario' ? ' on' : ''}`} onClick={() => setVista('calendario')}>Calendario</button>
      </div>

      {vista === 'calendario' ? (
        <Calendario tareas={tareas} />
      ) : (
      <>
      <div className="today">
        <div className="label">Hoy</div>
        <div className={`value${activaId ? ' running' : ''}`}>{formatDuracion(totalHoy)}</div>
      </div>

      <div className="section-title">Tareas</div>

      {cargando ? (
        <p className="spin">Cargando…</p>
      ) : tareas.length === 0 ? (
        <p className="empty">Aún no tienes tareas.<br />Crea la primera abajo 👇</p>
      ) : (
        <div className="tasks">
          {tareas.map((t) => {
            const on = activaId === t.id
            return (
              <div key={t.id} className={`task${on ? ' on' : ''}`}>
                <span className="swatch" style={{ background: t.color }} />
                <div className="info">
                  <div className="name">{t.nombre}</div>
                  <div className="time">Hoy · <b>{formatDuracion(segundosHoy(t.id))}</b></div>
                </div>
                <button className="play" onClick={() => alternar(t.id)} aria-label={on ? 'Pausar' : 'Iniciar'}>
                  {on ? (
                    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form className="add-row" onSubmit={anadirTarea}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nueva tarea…" maxLength={60} />
        <button className="btn-primary" type="submit" disabled={!nombre.trim()}>Añadir</button>
      </form>
      </>
      )}
    </div>
  )
}
