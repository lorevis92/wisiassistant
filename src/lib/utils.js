export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('it-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' }) : '')

export const slugify = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)

export const isoDay = (d) => new Date(d).toISOString().slice(0, 10)

export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function urlPathPrefixes(urls) {
  // Returns a map prefix -> count, with prefixes like /blog/, /en/, /tag/
  const counts = {}
  for (const u of urls) {
    try {
      const p = new URL(u).pathname
      const parts = p.split('/').filter(Boolean)
      if (parts.length >= 1) {
        const first = `/${parts[0]}/`
        counts[first] = (counts[first] || 0) + 1
        if (parts.length >= 2) {
          const second = `/${parts[0]}/${parts[1]}/`
          counts[second] = (counts[second] || 0) + 1
        }
      } else {
        counts['/'] = (counts['/'] || 0) + 1
      }
    } catch { /* ignore */ }
  }
  return Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
}

export function matchesPattern(url, pattern) {
  // pattern supports * wildcard; matches on full URL or on pathname when pattern starts with /
  if (!pattern) return false
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  const re = new RegExp(`^${esc}`, 'i')
  if (pattern.startsWith('/')) {
    try { return re.test(new URL(url).pathname) } catch { return false }
  }
  return re.test(url)
}

/** Converts [text](url) markdown links and bare URLs into anchor HTML (safe escaping). */
export function renderMessageHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = esc(text || '')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}
