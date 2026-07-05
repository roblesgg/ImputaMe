import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'

const HORA_PX = 48   // alto de cada hora (como el escritorio)
const COL = 116      // ancho de cada columna de día
const GUTTER = 44    // ancho de la columna de horas
const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function fmt(seg) {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}
function inicioDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
function lunesDe(ms) {
  const x = new Date(inicioDia(ms))
  const dow = (x.getDay() + 6) % 7 // 0 = lunes
  x.setDate(x.getDate() - dow)
  return x.getTime()
}

export default function Calendario({ tareas }) {
  const [semana, setSemana] = useState(lunesDe(Date.now()))
  const [fichajes, setFichajes] = useState([])
  const [now, setNow] = useState(Date.now())
  const scroller = useRef(null)

  const tareaDe = (id) => tareas.find((t) => t.id === id)
  const dias = Array.from({ length: 7 }, (_, i) => semana + i * 86400000)
  const wStart = semana, wEnd = semana + 7 * 86400000

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('fichajes')
      .select('*')
      .lt('inicio_ms', wEnd)
      .or(`fin_ms.gte.${wStart},fin_ms.is.null`)
    setFichajes(data || [])
  }, [wStart, wEnd])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    const canal = supabase
      .channel('cal-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fichajes' }, cargar)
      .subscribe()
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => { supabase.removeChannel(canal); clearInterval(id) }
  }, [cargar])

  // Al abrir, desplazar a las 8:00
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 8 * HORA_PX }, [])

  // Bloques por día
  function bloquesDe(dStart) {
    const dEnd = dStart + 86400000
    return fichajes
      .map((f) => {
        const fin = f.fin_ms ?? now
        const desde = Math.max(f.inicio_ms, dStart)
        const hasta = Math.min(fin, dEnd)
        return { ...f, desde, hasta, secs: Math.max(0, Math.floor((hasta - desde) / 1000)) }
      })
      .filter((b) => b.hasta > b.desde)
  }

  // Totales de la semana por tarea (para la leyenda)
  const totales = {}
  fichajes.forEach((f) => {
    const fin = f.fin_ms ?? now
    const desde = Math.max(f.inicio_ms, wStart)
    const hasta = Math.min(fin, wEnd)
    const s = Math.max(0, Math.floor((hasta - desde) / 1000))
    if (s > 0) totales[f.tarea_id] = (totales[f.tarea_id] || 0) + s
  })

  const finSemana = new Date(semana + 6 * 86400000)
  const iniSemana = new Date(semana)
  const rango = `${iniSemana.getDate()} ${iniSemana.toLocaleDateString('es-ES', { month: 'short' })} – ${finSemana.getDate()} ${finSemana.toLocaleDateString('es-ES', { month: 'short' })}`
  const hoy0 = inicioDia(now)

  return (
    <div className="wk">
      <div className="cal-nav">
        <button className="cal-arrow" onClick={() => setSemana(semana - 7 * 86400000)} aria-label="Semana anterior">‹</button>
        <div className="cal-date">
          <div className="cal-day" style={{ textTransform: 'none' }}>{rango}</div>
          <button className="wk-hoy" onClick={() => setSemana(lunesDe(Date.now()))}>Ir a hoy</button>
        </div>
        <button className="cal-arrow" onClick={() => setSemana(semana + 7 * 86400000)} aria-label="Semana siguiente">›</button>
      </div>

      {Object.keys(totales).length > 0 && (
        <div className="cal-chips">
          {Object.entries(totales).sort((a, b) => b[1] - a[1]).map(([id, secs]) => {
            const t = tareaDe(id)
            return (
              <span key={id} className="cal-chip">
                <span className="swatch" style={{ background: t?.color || '#888' }} />
                {t?.nombre || '—'} · <b>{fmt(secs)}</b>
              </span>
            )
          })}
        </div>
      )}

      {/* Rejilla semanal con scroll en ambos ejes */}
      <div className="wk-scroll" ref={scroller}>
        <div className="wk-inner" style={{ minWidth: GUTTER + 7 * COL }}>
          {/* Cabecera de días (sticky arriba) */}
          <div className="wk-head" style={{ width: GUTTER + 7 * COL }}>
            <div className="wk-corner" style={{ width: GUTTER }} />
            {dias.map((d) => {
              const fecha = new Date(d)
              const esHoy = inicioDia(d) === hoy0
              return (
                <div key={d} className={`wk-dh${esHoy ? ' hoy' : ''}`} style={{ width: COL }}>
                  <span className="wk-dow">{DOW[(new Date(d).getDay() + 6) % 7]}</span>
                  <span className="wk-dnum">{fecha.getDate()}</span>
                </div>
              )
            })}
          </div>

          {/* Cuerpo: gutter de horas (sticky izq) + columnas */}
          <div className="wk-row" style={{ height: 24 * HORA_PX }}>
            <div className="wk-gutter" style={{ width: GUTTER }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="wk-hr" style={{ height: HORA_PX }}>
                  <span>{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            {dias.map((d) => {
              const esHoy = inicioDia(d) === hoy0
              return (
                <div key={d} className="wk-col" style={{ width: COL, height: 24 * HORA_PX }}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="wk-line" style={{ top: h * HORA_PX }} />
                  ))}
                  {bloquesDe(d).map((b) => {
                    const top = ((b.desde - d) / 86400000) * 24 * HORA_PX
                    const alto = Math.max(14, ((b.hasta - b.desde) / 86400000) * 24 * HORA_PX)
                    const t = tareaDe(b.tarea_id)
                    const color = t?.color || '#6366f1'
                    return (
                      <div key={b.id} className="wk-block" style={{ top, height: alto, background: color + '33', borderColor: color }}>
                        <span className="wk-bar" style={{ background: color }} />
                        <div className="wk-btxt">
                          <b>{t?.nombre || '—'}</b>
                          <span>{fmt(b.secs)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {esHoy && <div className="wk-now" style={{ top: ((now - d) / 86400000) * 24 * HORA_PX }} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
