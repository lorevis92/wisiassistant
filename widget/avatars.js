/**
 * Avatars of the assistant. Shared by the widget, the standalone page and the admin panel.
 * Stored in clients.widget (JSON, no dedicated columns):
 *   avatar        = { kind: 'preset' | 'image', preset, bg, fg, url }  → launcher (chat closed)
 *   header_avatar = same shape, or null                                  → chat header + bot messages (chat open);
 *                   null / missing / unusable → falls back to the launcher avatar, then to the default silhouette.
 * Legacy configs with only widget.avatar_url are read as an uploaded launcher image.
 */

export const AVATAR_PRESETS = [
  { id: 'person', label: 'Omino' },
  { id: 'chat', label: 'Fumetto' },
  { id: 'sparkle', label: 'Stella' },
  { id: 'headset', label: 'Cuffie' },
  { id: 'bot', label: 'Robot' },
]

export const DEFAULT_AVATAR = { kind: 'preset', preset: 'person', bg: '#E8352A', fg: '#FFFFFF', url: '' }

/** Only plain hex colors reach CSS / SVG: anything else falls back (no injection through config values). */
export function safeColor(c, fallback) {
  return typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : fallback
}

export function safeUrl(u) {
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : ''
}

function cleanAvatar(a, base) {
  const out = {
    kind: a.kind === 'image' ? 'image' : 'preset',
    preset: AVATAR_PRESETS.some((p) => p.id === a.preset) ? a.preset : base.preset,
    bg: safeColor(a.bg, base.bg),
    fg: safeColor(a.fg, base.fg),
    url: safeUrl(a.url),
  }
  if (out.kind === 'image' && !out.url) out.kind = 'preset'
  return out
}

/** Launcher avatar (chat closed). Never empty: default silhouette in the main color. */
export function resolveAvatar(widget) {
  const w = widget || {}
  const a = w.avatar && typeof w.avatar === 'object' ? w.avatar : null
  const base = { ...DEFAULT_AVATAR, bg: safeColor(w.color, DEFAULT_AVATAR.bg) }
  if (!a) return w.avatar_url && safeUrl(w.avatar_url) ? { ...base, kind: 'image', url: safeUrl(w.avatar_url) } : base
  return cleanAvatar(a, base)
}

/** Header / profile avatar (chat open). Unset or an image without a valid URL → the launcher avatar. */
export function resolveHeaderAvatar(widget) {
  const launcher = resolveAvatar(widget)
  const h = widget && widget.header_avatar && typeof widget.header_avatar === 'object' ? widget.header_avatar : null
  if (!h || (h.kind === 'image' && !safeUrl(h.url))) return launcher
  return cleanAvatar(h, { ...launcher, preset: 'person' })
}

const FIGURES = {
  person: (fg) => `<circle cx="32" cy="25" r="10" fill="${fg}"/><path d="M13 54c0-10.5 8.5-18 19-18s19 7.5 19 18z" fill="${fg}"/>`,
  chat: (fg, bg) => `<path d="M17 18h30a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H31l-9 7v-7h-5a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5z" fill="${fg}"/><circle cx="24" cy="30.5" r="2.6" fill="${bg}"/><circle cx="32" cy="30.5" r="2.6" fill="${bg}"/><circle cx="40" cy="30.5" r="2.6" fill="${bg}"/>`,
  sparkle: (fg) => `<path d="M32 13l4.6 14.4L51 32l-14.4 4.6L32 51l-4.6-14.4L13 32l14.4-4.6z" fill="${fg}"/><path d="M47 12l1.6 4.4L53 18l-4.4 1.6L47 24l-1.6-4.4L41 18l4.4-1.6z" fill="${fg}" opacity=".75"/>`,
  headset: (fg) => `<path d="M18 37v-5a14 14 0 0 1 28 0v5" fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round"/><rect x="13" y="34" width="9" height="13" rx="3.5" fill="${fg}"/><rect x="42" y="34" width="9" height="13" rx="3.5" fill="${fg}"/><path d="M46.5 47c0 3.5-3.5 6-9 6H34" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round"/>`,
  bot: (fg, bg) => `<line x1="32" y1="14" x2="32" y2="22" stroke="${fg}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="13" r="3" fill="${fg}"/><rect x="16" y="22" width="32" height="25" rx="8" fill="${fg}"/><circle cx="25.5" cy="34" r="3.4" fill="${bg}"/><circle cx="38.5" cy="34" r="3.4" fill="${bg}"/><rect x="11" y="31" width="4" height="8" rx="2" fill="${fg}"/><rect x="49" y="31" width="4" height="8" rx="2" fill="${fg}"/>`,
}

export function presetSvg(preset, bg, fg) {
  const fig = (FIGURES[preset] || FIGURES.person)(fg, bg)
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect width="64" height="64" fill="${bg}"/>${fig}</svg>`
}

/** Markup for an avatar container (the container clips it to a circle). */
export function avatarMarkup(avatar) {
  if (avatar.kind === 'image' && avatar.url) return `<img class="avatar-img" src="${avatar.url.replace(/"/g, '%22')}" alt="">`
  return presetSvg(avatar.preset, avatar.bg, avatar.fg)
}
