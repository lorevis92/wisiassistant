// Modelli AI selezionabili per ogni cliente. Il provider determina quale API key viene usata
// nella edge function `chat` (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, MISTRAL_API_KEY, XAI_API_KEY, GROQ_API_KEY).
// Per aggiungere un modello basta aggiungere una riga qui: la edge function usa provider + id.
export const MODELS = [
  { provider: 'anthropic', id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 'Economico · veloce' },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'Bilanciato' },
  { provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'Massima qualità' },
  { provider: 'openai', id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'Economico' },
  { provider: 'openai', id: 'gpt-5', label: 'GPT-5', tier: 'Bilanciato' },
  { provider: 'google', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'Economico · veloce' },
  { provider: 'google', id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'Alta qualità' },
  { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small', tier: 'Economico · EU' },
  { provider: 'mistral', id: 'mistral-large-latest', label: 'Mistral Large', tier: 'Alta qualità · EU' },
  { provider: 'xai', id: 'grok-4-fast', label: 'Grok 4 Fast', tier: 'Economico' },
  { provider: 'groq', id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', tier: 'Economico · open' },
]

export const DEFAULT_MODEL = 'anthropic/claude-haiku-5-5'

export const modelKey = (m) => `${m.provider}/${m.id}`
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
