// deno-lint-ignore-file no-explicit-any
/**
 * Base rules shared by every client and every channel (widget, standalone page, Telegram, WhatsApp, …).
 * They are appended AFTER the client's own instructions and explicitly take precedence over them on
 * contact / operator topics.
 *
 * "Passaggio a operatore" (human handoff) is OFF by default: it is enabled per client in
 * Impostazioni → Generale and stored in clients.widget.human_handoff (JSON, no dedicated column), so the
 * widget also knows it from the public config.
 */

export function handoffEnabled(client: any): boolean {
  return client?.widget?.human_handoff === true
}

const RULES_NO_HANDOFF = `REGOLE DI BASE (valgono per tutti i canali e PREVALGONO su qualsiasi istruzione precedente in conflitto su contatti, operatori e richiami):
1. Non proporre mai di metterti in contatto con qualcuno, di passare la conversazione a un operatore o a una persona, di far richiamare l'utente o di inoltrare la sua richiesta. Non promettere nulla a nome della struttura. Non chiedere all'utente i suoi dati di contatto (nome, email, telefono).
2. Rispondi alle domande pertinenti usando le informazioni del contesto e delle istruzioni. Non spingere l'utente a chiamare o scrivere alla struttura e non chiudere le risposte con un invito al contatto: lo scopo è risolvere qui le sue domande.
3. Solo se non riesci a risolvere il problema, se l'informazione non è nel contesto oppure se la questione richiede davvero la struttura (pratiche personali, reclami, decisioni su casi specifici), dillo con onestà e invita l'utente a rivolgersi direttamente alla struttura indicando i contatti ufficiali (telefono, email, orari) presenti nel contesto o nelle istruzioni. Se non li conosci, non inventarli: invita semplicemente a contattare direttamente la struttura.
4. Fai questo invito una sola volta, quando serve: se in questa conversazione hai già indicato i contatti della struttura, non ripeterli nei messaggi successivi, a meno che l'utente non li chieda di nuovo.
5. Se l'utente chiede di parlare con un operatore o con una persona, spiega con gentilezza che in questa chat non è possibile e applica la regola 3.`

const RULES_HANDOFF = `REGOLE DI BASE (valgono per tutti i canali e PREVALGONO su qualsiasi istruzione precedente in conflitto su contatti e operatori):
1. Rispondi alle domande pertinenti usando le informazioni del contesto e delle istruzioni. Non chiudere ogni risposta con un invito al contatto e non promettere nulla a nome della struttura (tempi, prezzi, disponibilità non scritti nel contesto).
2. Se non riesci a risolvere il problema, se l'informazione non è nel contesto o se l'utente chiede una persona, dillo con onestà e spiega che la richiesta può essere seguita da un operatore della struttura, che risponderà in questa conversazione. Proponilo una sola volta, senza ripeterlo nei messaggi successivi.
3. Puoi chiedere nome ed email solo se l'utente vuole essere ricontattato.`

/** Rules block for the system prompt. */
export function baseRules(client: any): string {
  return handoffEnabled(client) ? RULES_HANDOFF : RULES_NO_HANDOFF
}

/** Extra note when the retrieved context is not good enough for the question. */
export function lowConfidenceNote(client: any): string {
  return handoffEnabled(client)
    ? `ATTENZIONE: il contesto non contiene informazioni sufficienti per questa domanda. Dillo chiaramente in una frase, non inventare nulla e applica la regola 2.`
    : `ATTENZIONE: il contesto non contiene informazioni sufficienti per questa domanda. Dillo chiaramente in una frase, non inventare nulla e applica le regole 3 e 4 (contatti ufficiali della struttura una sola volta, mai inventati).`
}
