/**
 * Product name and public base URL. The base URL is used in the widget snippet and in every shareable link
 * (standalone chat page). Set VITE_PUBLIC_APP_URL (e.g. https://sardesk.ai) in Vercel when the domain is
 * connected; without it the current origin is used.
 */
export const BRAND = 'Sardesk'

export const APP_URL = String(import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : ''))
  .trim().replace(/\/+$/, '')

export const standaloneUrl = (slug) => `${APP_URL}/c/${slug}`
export const widgetSnippet = (slug) => `<script src="${APP_URL}/widget.js" data-client="${slug}" async></script>`
