import { useId } from 'react'
import { useTheme } from '../lib/theme'
import { BRAND } from '../lib/brand'

/**
 * Sardesk symbol: a stylised nuraghe (three courses of stone, a doorway) in the teal → violet gradient, with the coral
 * light on top: the watchtower that guides. The glow comes from CSS (.brand .mark). `flat` paints it in currentColor.
 */
export function Mark({ size = 28, light = 'var(--coral)', className = 'mark', flat = false }) {
  const id = `sd-g-${useId().replace(/:/g, '')}`
  const fill = flat ? 'currentColor' : `url(#${id})`
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {!flat && (
        <defs>
          <linearGradient id={id} x1="6" y1="27" x2="26" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22E6D6" />
            <stop offset="0.5" stopColor="#5FA8F2" />
            <stop offset="1" stopColor="#8B6CFF" />
          </linearGradient>
        </defs>
      )}
      <g fill={fill}>
        <path fillRule="evenodd" d="M6.4 27 8 21h16l1.6 6Zm8.1 0v-2.6a1.5 1.5 0 0 1 3 0V27Z" />
        <path d="M8.4 19.4 9.7 14.4h12.6l1.3 5Z" />
        <path d="M10.1 12.8 11 9.2h10l.9 3.6Z" />
      </g>
      <circle cx="16" cy="5.4" r="2" fill={light} />
    </svg>
  )
}

export function Logo({ size = 28 }) {
  return (
    <span className="brand" aria-label={BRAND}>
      <Mark size={size} />
      <span className="word" aria-hidden="true">{BRAND}</span>
    </span>
  )
}

const ICONS = {
  light: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  dark: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>,
  auto: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>,
}
const LABELS = { light: 'Tema chiaro', dark: 'Tema scuro', auto: 'Tema automatico (come il sistema)' }

/** Light / dark / auto selector; the choice is remembered (src/lib/theme.js). */
export function ThemeSwitch() {
  const [pref, setPref] = useTheme()
  const keys = ['light', 'dark', 'auto']
  const onKey = (e) => {
    const i = keys.indexOf(pref)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setPref(keys[(i + 1) % 3]) }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setPref(keys[(i + 2) % 3]) }
  }
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Tema" onKeyDown={onKey}>
      {keys.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={pref === k} aria-label={LABELS[k]} title={LABELS[k]}
          tabIndex={pref === k ? 0 : -1} onClick={() => setPref(k)}>{ICONS[k]}</button>
      ))}
    </div>
  )
}
