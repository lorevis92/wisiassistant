import { useEffect, useState } from 'react'

/**
 * Light / dark / auto theme for the whole app (admin, login, standalone page). The choice is remembered in
 * localStorage; "auto" follows the operating system. index.html applies it before the first paint (no flash).
 * The resolved theme lives on <html data-theme="light|dark">, which the CSS tokens (src/styles/tokens.css) and the
 * chat UI in page mode read.
 */
export const THEME_KEY = 'sardesk-theme'
export const THEMES = ['light', 'dark', 'auto']

const mq = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

export function getThemePref() {
  // dark-first: dark is the default until the user picks something else
  try { const v = localStorage.getItem(THEME_KEY); return THEMES.includes(v) ? v : 'dark' } catch { return 'dark' }
}

export function resolveTheme(pref) {
  return pref === 'dark' || pref === 'light' ? pref : mq()?.matches ? 'dark' : 'light'
}

export function applyTheme(pref) {
  const root = document.documentElement
  const theme = resolveTheme(pref)
  root.dataset.theme = theme
  root.dataset.themePref = pref
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#05070B' : '#F6F7FB')
  window.dispatchEvent(new CustomEvent('sardesk-theme', { detail: { pref, theme } }))
}

export function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref) } catch { /* private mode: applies for this visit only */ }
  applyTheme(pref)
}

export function useTheme() {
  const [pref, setPref] = useState(getThemePref)
  useEffect(() => {
    const m = mq()
    const onSystem = () => { if (getThemePref() === 'auto') applyTheme('auto') }
    const onOther = (e) => setPref(e.detail.pref)
    m?.addEventListener?.('change', onSystem)
    window.addEventListener('sardesk-theme', onOther)
    return () => { m?.removeEventListener?.('change', onSystem); window.removeEventListener('sardesk-theme', onOther) }
  }, [])
  return [pref, (p) => { setThemePref(p); setPref(p) }]
}
