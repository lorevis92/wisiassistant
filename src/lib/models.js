// Modelli AI selezionabili per ogni cliente. Il provider determina quale API key viene usata
// nella edge function `chat` (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, MISTRAL_API_KEY, XAI_API_KEY, GROQ_API_KEY).
// Per aggiungere un modello basta aggiungere una riga qui: la edge function usa provider + id.
// speed: how long a visitor waits for the first words of an answer (streamed), with the settings used by the chat
// function (least reasoning allowed by each model). Indicative: it also depends on the provider's load.
//   fast   → usually within ~1 s     medium → ~1–2 s     slow → 2–5 s (larger models, or reasoning that cannot be turned off)
export const MODELS = [
  { provider: 'anthropic', id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 'Economico', speed: 'fast' },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'Bilanciato', speed: 'medium' },
  { provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'Massima qualità', speed: 'slow' },
  { provider: 'openai', id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'Economico', speed: 'medium' },
  { provider: 'openai', id: 'gpt-5', label: 'GPT-5', tier: 'Bilanciato', speed: 'slow' },
  { provider: 'google', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'Economico', speed: 'fast' },
  { provider: 'google', id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'Alta qualità', speed: 'slow' },
  { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small', tier: 'Economico · EU', speed: 'fast' },
  { provider: 'mistral', id: 'mistral-large-latest', label: 'Mistral Large', tier: 'Alta qualità · EU', speed: 'medium' },
  { provider: 'xai', id: 'grok-4-fast', label: 'Grok 4 Fast', tier: 'Economico', speed: 'medium' },
  { provider: 'groq', id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', tier: 'Economico · open', speed: 'fast' },
]

export const SPEEDS = {
  fast: { label: 'Veloce', hint: 'prime parole di solito entro 1 secondo', badge: 'green' },
  medium: { label: 'Medio', hint: 'prime parole in 1–2 secondi', badge: 'yellow' },
  slow: { label: 'Lento', hint: 'prime parole in 2–5 secondi: più qualità su domande complesse, più attesa per il visitatore', badge: 'red' },
}
export const modelSpeed = (key) => MODELS.find((x) => modelKey(x) === key)?.speed || null

// default for new clients: a fast model (support answers grounded in the site's content do not need a large one)
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5-5'

export const modelKey = (m) => `${m.provider}/${m.id}`
/** Temperature is not used by Claude (Anthropic) nor by OpenAI reasoning models (GPT-5, o-series): keep in sync with llm() in common.ts. */
export const supportsTemperature = (key) => {
  const [provider, ...rest] = String(key || '').split('/')
  const id = rest.join('/')
  if (provider === 'anthropic') return false
  if (provider === 'openai' && ((/^gpt-5/.test(id) && !/-chat/.test(id)) || /^o\d/.test(id))) return false
  return true
}
export const modelLabel = (key) => {
  const m = MODELS.find((x) => modelKey(x) === key)
  return m ? m.label : key
}

export const CHANNELS = [
  { id: 'web', label: 'Widget sito' },
  { id: 'standalone', label: 'Pagina standalone' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'email', label: 'Email' },
]

export const LANGS = [
  { id: 'auto', label: 'Automatica (lingua dell’utente)' },
  { id: 'it', label: 'Italiano' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
]
