import { useEffect, useMemo, useRef, useState } from 'react'

const niceStep = (max) => {
  if (max <= 4) return 1
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)
}

/** Column path with a 4px rounded data end and a square baseline. */
function column(x, y, w, h) {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/**
 * Single-series column chart (no legend: the card title names the series). Hover / focus a day for its value;
 * the same numbers are available as a table under "Dati del grafico".
 * data: [{ key, label, short, value }]
 */
export default function BarChart({ data, height = 200, unit = 'conversazioni', ariaLabel }) {
  const wrap = useRef(null)
  const [hover, setHover] = useState(null)
  const [W, setW] = useState(640)
  // draw in real pixels: text and bars keep their size at any width
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = height, padL = 32, padB = 26, padT = 10
  const max = Math.max(0, ...data.map((d) => d.value))
  const step = niceStep(max || 1)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks = useMemo(() => Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), [top, step])
  const slot = (W - padL) / Math.max(1, data.length)
  const bw = Math.max(3, Math.min(24, slot - 4))
  const y = (v) => padT + (H - padT - padB) * (1 - v / top)
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 110)))
  const total = data.reduce((a, d) => a + d.value, 0)

  const tip = hover != null ? data[hover] : null
  const tipX = hover != null ? Math.min(W - 70, Math.max(70, padL + slot * hover + slot / 2)) : 0
  const tipY = tip ? y(tip.value) : 0

  return (
    <div className="chart" ref={wrap} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel || `${total} ${unit} in ${data.length} giorni`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
            <text className="tick" x={padL - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + slot * i + (slot - bw) / 2
          return (
            <g key={d.key}>
              <path className={`bar${hover != null && hover !== i ? ' dim' : ''}`} d={column(x, y(d.value), bw, y(0) - y(d.value))} />
              {/* hit target: the whole slot, taller than the mark */}
              <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent"
                tabIndex={0} aria-label={`${d.label}: ${d.value} ${unit}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              {i % labelEvery === 0 && <text className="tick" x={padL + slot * i + slot / 2} y={H - 6} textAnchor="middle">{d.short}</text>}
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="tip" style={{ left: tipX, top: tipY - 8 }}>
          <b>{tip.value}</b> <span className="secondary">{tip.value === 1 ? unit.replace(/i$/, 'e') : unit}</span>
          <div className="muted">{tip.label}</div>
        </div>
      )}
      <details style={{ marginTop: 8 }}>
        <summary className="small secondary" style={{ cursor: 'pointer' }}>Dati del grafico</summary>
        <div className="table-wrap" style={{ maxHeight: 220, marginTop: 8 }}>
          <table className="table"><thead><tr><th>Giorno</th><th style={{ textAlign: 'right' }}>{unit}</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td className="mono" style={{ textAlign: 'right' }}>{d.value}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
