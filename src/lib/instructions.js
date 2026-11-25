/**
 * Detects sentences in a client's custom instructions that contradict the base rules on contact / operators
 * (supabase/functions/_shared/policy.ts). The base rules win anyway; this only helps the admin clean the text.
 */
const PATTERNS_NO_HANDOFF = [
  [/mett\w*\s+(?:l['’]\s*utente\s+|il\s+cliente\s+|l['’]\s*ospite\s+)?in\s+contatto/i, 'propone di mettere in contatto'],
  [/(?:passa|trasferi|inoltr|gir)\w*\s+(?:la\s+)?(?:conversazione|chat|richiesta|domanda)/i, 'propone di passare o inoltrare la richiesta'],
  [/\b(?:operatore|operatrice|persona\s+(?:reale|del\s+team|dello\s+staff)|umano)\b/i, 'parla di operatore / persona'],
  [/ricontatt|richiam|ti\s+(?:faremo|faranno)\s+sapere/i, 'promette di ricontattare'],
  [/(?:chiedi|raccogli|domanda)\w*\s+(?:sempre\s+)?(?:il\s+|i\s+|l['’]\s*)?(?:nome|email|e-mail|telefono|numero|dati|contatti|recapit)/i, 'chiede i dati di contatto'],
  [/(?:alla\s+fine|in\s+fondo|sempre|ogni\s+risposta).{0,60}(?:contatt|chiam|scriv)/i, 'invita sempre al contatto'],
]
// answer rules (every client): the content comes first, the link only completes it
const LINK_ONLY = [
  [/(rimand|indirizz|invit|manda)\w*\s+(sempre\s+)?(l['’]\s*utente\s+|il\s+cliente\s+|i\s+visitatori\s+)?(al|alla|ai|alle|sul|sulla)\s+(link|pagin|sito)/i, 'fa rispondere con il solo link invece delle informazioni'],
  [/(solo|soltanto|unicamente|semplicemente)\s+(con\s+)?(il|un|i|dei)\s+link/i, 'chiede di rispondere solo con il link'],
  [/non\s+(dare|fornire|riportare|scrivere|elencare|indicare)\s+(i\s+|le\s+|gli\s+)?(dettagli|prezzi|orari|tariffe|informazioni|condizioni)/i, 'vieta di dare le informazioni concrete'],
  [/(sii|rispondi\s+in\s+modo)\s+(molto\s+|estremamente\s+)?(brev|breviss|sintetic)\w*.{0,40}(link|pagin)/i, 'spinge a sostituire la risposta con il link'],
]
const PATTERNS_HANDOFF = [
  [/(?:alla\s+fine|in\s+fondo|sempre|ogni\s+risposta).{0,60}(?:contatt|chiam|scriv)/i, 'invita sempre al contatto'],
]

/** Returns [{ sentence, reason }] for sentences that conflict with the base rules. */
export function instructionConflicts(text, handoff = false) {
  const patterns = [...LINK_ONLY, ...(handoff ? PATTERNS_HANDOFF : PATTERNS_NO_HANDOFF)]
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  const out = []
  for (const s of sentences) {
    const hit = patterns.find(([re]) => re.test(s))
    if (hit) out.push({ sentence: s, reason: hit[1] })
  }
  return out
}
