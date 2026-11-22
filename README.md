# Sardesk

Piattaforma di customer support AI (sardo + desk: l'assistente che ti aiuta).
I nomi tecnici restano quelli della prima versione: prefisso `wa_` di tabelle/funzioni/bucket, nome del repository e variabili.
Un admin (tu) gestisce N clienti; ogni cliente ha la propria knowledge base (sito crawlato + documenti + FAQ),
il proprio modello AI, il proprio widget e i propri canali.

```
wisiassistant/
├── src/                 dashboard React (Vite) → Vercel
├── widget/widget.js     widget embeddabile (vanilla JS, Shadow DOM) → dist/widget.js
├── supabase/
│   ├── migrations/      schema Postgres + pgvector + RLS + cron
│   └── functions/       edge functions: chat, ingest, generate-report, send-report, telegram-webhook, whatsapp-webhook
└── crawler/             servizio Crawl4AI (FastAPI + Playwright) → Railway (Docker)
```

## Funzionalità

- **Crawling intelligente**: mappa il sito (sitemap + link), seleziona/escludi per gruppo o pattern, regole include/exclude salvate, crawl in background con progress live, tabella pagine indicizzate (cerca, ordina per peso, disattiva, elimina per prefisso, re-crawl).
- **Link alla sezione**: ogni chunk conserva URL + gerarchia dei titoli + anchor reale (`#id`) → il bot inserisce i link in modo naturale nella risposta (comportamento guidato dalle istruzioni del cliente).
- **Knowledge extra**: PDF/DOCX/TXT, FAQ scritte a mano, testo libero.
- **Modello AI per cliente**: Anthropic, OpenAI, Google, Mistral, xAI, Groq (lista in `src/lib/models.js`).
- **Conversazioni**: storico per cliente, filtri data/canale/stato, vista a bolle, export PDF del periodo.
- **Contatti e operatori**: regole di base comuni a tutti i clienti e canali (`supabase/functions/_shared/policy.ts`), che prevalgono sulle istruzioni personalizzate:
  l'assistente non propone mai operatori, richiami o inoltri e non chiede i contatti; solo quando non può aiutare invita una volta a rivolgersi alla struttura con i contatti ufficiali (mai inventati).
- **Inbox / passaggio a operatore** (facoltativo, spento di default, Impostazioni → Generale): escalation automatica con email + handoff live (rispondi tu, su qualsiasi canale).
- **Lead capture**, feedback 👍/👎, domande senza risposta, analytics, domain lock facoltativo (nessun dominio = widget ovunque; localhost e file:// sempre ammessi), rate limiting.
- **Report AI periodici**: settimanali/quindicinali/mensili, bozza → modifica → approva → invio (o invio automatico).
- **Canali**: widget sito, pagina standalone `/c/<slug>`, Telegram, WhatsApp Cloud API, Instagram/Messenger (stesso webhook), email.

## Setup (una volta sola)

### 1. Supabase
1. Il progetto è il Supabase condiviso **wisinvaders** (vedi *Database condiviso* sotto). Assicurati che l'utente admin
   (`lorewhiskey@gmail.com`) esista in Authentication → Users, poi SQL Editor → esegui `supabase/migrations/0001_init.sql`
   (lo inserisce in `wa_admins`). Per aggiungere altri admin: `insert into public.wa_admins(user_id) select id from auth.users where email = '...';`
2. Solo gli utenti in `wa_admins` possono entrare nel pannello: gli altri utenti del progetto (di altre app) vedono "Accesso non autorizzato".
3. Project Settings → API: copia `URL`, `anon key`, `service_role key`.
4. Installa la CLI (`npm i -g supabase`), poi:
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... RESEND_API_KEY=re_... \
     REPORT_FROM_EMAIL="Sardesk <assistant@tuodominio.com>" PUBLIC_APP_URL=https://sardesk.ai \
     TELEGRAM_WEBHOOK_SECRET=<stringa-casuale> META_VERIFY_TOKEN=<stringa-casuale>
   supabase functions deploy chat --no-verify-jwt
   supabase functions deploy ingest
   supabase functions deploy generate-report --no-verify-jwt
   supabase functions deploy send-report
   supabase functions deploy send-invite
   supabase functions deploy telegram-webhook --no-verify-jwt
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   ```
   `OPENAI_API_KEY` serve sempre (embedding `text-embedding-3-small`). Le altre chiavi solo per i provider che userai.
5. Report automatici: apri `supabase/migrations/0002_cron.sql`, sostituisci `<PROJECT_REF>` e `<SERVICE_ROLE_KEY>`, esegui nel SQL Editor.

### 2. Crawler su Railway
1. Railway → New project → **Deploy from GitHub repo** → seleziona questo repo, Root Directory = `crawler`.
2. Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `CRAWLER_SECRET` (opzionale), `CRAWL_CONCURRENCY=4`.
3. Settings → Networking → Generate domain. Copia l'URL (es. `https://wisiassistant-crawler.up.railway.app`).
   Render funziona uguale (Docker, root `crawler`). Il primo build scarica Chromium (~3 minuti).
4. Re-crawl automatico: imposta `CRAWLER_SECRET` (obbligatorio per il cron), poi apri `supabase/migrations/0003_recrawl.sql`,
   sostituisci `<CRAWLER_URL>` e `<CRAWLER_SECRET>` ed eseguilo nel SQL Editor. Ogni giorno alle 02:30 UTC il job `wa_recrawl`
   chiama `POST /recrawl/scheduled`; la frequenza si sceglie per cliente in Impostazioni → Crawling.
   Il re-crawl rimappa il sito, rispetta le regole include/exclude, indicizza le pagine nuove, ri-embedda solo quelle cambiate,
   disattiva quelle sparite (stato "Sparita") e segnala quelle non più collegate. Documenti, FAQ e testi manuali non vengono toccati.
   Se il mapping trova 0 URL o meno del 30% delle pagine già indicizzate, il re-crawl si ferma in errore senza modificare nulla.
5. Immagini del widget: esegui `supabase/migrations/0004_widget_avatars.sql` (bucket `wa-avatars`). L'aspetto del widget e della pagina
   standalone si configura in Impostazioni → Aspetto, con anteprima dal vivo.
6. **Database indietro rispetto al codice?** (es. errore "Could not find the 'recrawl_frequency' column … in the schema cache"):
   esegui `supabase/migrations/0005_schema_recovery.sql` nel SQL Editor. È idempotente, non cancella dati, riunisce 0001/0003/0004
   e ricarica la cache dello schema. I cron con segreti (`wa_reports`, `wa_recrawl`) restano da 0002/0003.

### 3. Frontend su Vercel
1. Importa il repo. Framework: Vite. Build command `npm run build`, output `dist`.
   È tutto già in `vercel.json` (`framework: vite`): Vercel lo tratta come progetto singolo. `.vercelignore` esclude `crawler/`
   (gira su Railway/Render) e `supabase/` (deploy con la CLI Supabase).
2. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CRAWLER_URL` (URL Railway) e, facoltativa,
   `VITE_PUBLIC_APP_URL` = indirizzo pubblico dell'app (es. `https://sardesk.ai`). È usato nello snippet del widget e nei link
   alla pagina chat; se manca si usa il dominio da cui apri il pannello. Quando colleghi `sardesk.ai` basta cambiare questa
   variabile (e `PUBLIC_APP_URL` nei secrets di Supabase, per i link nelle email) e rifare il deploy.
3. Deploy. Il widget è servito su `https://<dominio>/widget.js`.
   Ricorda: dopo aver aggiunto env var su Vercel serve un redeploy.

### 4. Marchio e design ("Cala Elettrica")
Il logotipo (nuraghe stilizzato nel gradiente turchese-viola, con la luce corallo + scritta "Sardesk") è in
`src/components/Brand.jsx`, la favicon in `public/favicon.svg`. Colori, gradienti, bagliori, tipografia (Unbounded, Geist),
raggi, ombre e spaziature sono design token in un solo file: `src/styles/tokens.css`. Il tema scuro è quello principale;
il selettore chiaro / scuro / automatico è nella barra laterale (in alto su telefono) e la scelta viene ricordata.
Il widget ha un suo tema in Impostazioni → Aspetto (automatico = segue il sito che lo ospita); il colore predefinito
`#22E6D6` viene disegnato come gradiente turchese-viola, un colore scelto per il cliente viene usato così com'è.

## Uso

1. **Clienti → Nuovo cliente** (nome, sito) → vai su **Crawling → Scopri & crawla → Mappa il sito**.
2. Deseleziona/escludi i gruppi che non servono (`/blog/`, `/tag/`, lingue inutili…) → **Crawla N pagine**. Il progresso è live.
3. **Impostazioni**: modello AI, istruzioni (tono, uso dei link), widget, domini autorizzati, email escalation, canali, report.
4. **Panoramica**: copia lo snippet `<script src=".../widget.js" data-client="slug">` e incollalo nel sito del cliente.
5. Telegram: crea il bot con @BotFather, salva il token in Impostazioni, poi registra il webhook:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook?client=<SLUG>&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
6. WhatsApp/Instagram/Messenger: Meta for Developers → app → Webhooks → URL `https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook?client=<SLUG>`, verify token = `META_VERIFY_TOKEN`; salva Phone Number ID e access token in Impostazioni.

## Organizzazioni e ruoli

Ogni cliente appartiene a un'**organizzazione** (`wa_organizations`). Le persone ne fanno parte (`wa_org_members`) con un ruolo:

| Ruolo | Cosa può fare |
|---|---|
| **Owner** (uno solo) | tutto; non può essere rimosso né declassato |
| **Admin** | tutti i clienti dell'organizzazione, creare clienti, gestire il team (ruoli, assegnazioni, rimozioni, inviti anche admin) |
| **Collaboratore** | solo i clienti assegnati (`wa_client_assignments`): conversazioni, knowledge, impostazioni, report. Non vede gli altri clienti nemmeno per nome. Può invitare solo collaboratori, solo sui propri clienti |

- **Inviti** (pagina *Team*, migrazione 0007): email, ruolo, clienti, scadenza. Il sistema guarda se esiste già un account
  confermato con quell'email:
  - **nessun account** → email d'invito di Supabase Auth (`inviteUserByEmail`, funzione `send-invite`). La persona apre il
    link, sceglie la password su `/welcome` e, con l'email verificata, entra **da sola** (`wa_claim_invites` a ogni accesso);
  - **account esistente** → l'invito compare nell'app (avviso dopo l'accesso e voce *Inviti* nel menu) con **Accetta / Rifiuta**;
    l'email parte solo se Resend è configurato (`RESEND_API_KEY`), e la finestra d'invito lo dice.
  - Sempre disponibile anche il **link da copiare** (monouso, solo per quell'email). Ogni ingresso richiede l'email
    **verificata** e uguale a quella invitata. Stati in Team: inviato, in attesa di accettazione, da consegnare, accettato,
    rifiutato, scaduto, revocato.
- **Iscrizione**: chi si registra senza invito non diventa mai owner/admin da solo. Dopo l'accesso vede "Non fai parte di
  nessuna organizzazione" con gli inviti ricevuti e, solo se l'iscrizione libera è accesa, il pulsante "Crea la tua
  organizzazione". Iscrizione libera spenta: per attivarla `update public.wa_settings set value = 'true' where key = 'public_signup';`
  (compare anche la pagina *Registrati*).
- **Piano e limiti**: `wa_organizations.plan` e `limits` (`clients`, `members`, `messages_per_month`; `null` = illimitato).
  Clienti e membri sono già controllati dal database; messaggi e pagamenti arriveranno dopo. Si cambiano solo da SQL Editor.
- **Sicurezza**: tutto passa dalle funzioni SQL `wa_is_member`, `wa_is_org_admin`, `wa_can_access_client`,
  `wa_can_access_conversation` (security definer, senza ricorsioni): RLS su tutte le tabelle `wa_` e sui bucket
  `wa-documents` / `wa-avatars`. Le Edge Functions e il crawler verificano lato server l'accesso al cliente con il token
  dell'utente; i job programmati accettano solo il service role / `CRAWLER_SECRET`. Widget, pagina chat, Telegram e
  WhatsApp non cambiano (passano dalle funzioni con service role, senza login).
- Membri, ruoli, assegnazioni e inviti si cambiano **solo** tramite funzioni (`wa_create_invite`, `wa_accept_invite`,
  `wa_set_member_role`, `wa_remove_member`, `wa_set_client_assignments`, …): le tabelle non accettano scritture dirette.

### Migrazione 0007 (flusso inviti)
Dopo la 0006: SQL Editor → `supabase/migrations/0007_invite_flow.sql` (idempotente) → deploy di `send-invite`.
In Supabase → Authentication verifica (impostazioni condivise con le altre app, non le cambia il codice):
*Confirm email* attivo, registrazioni consentite, `<APP_URL>/welcome` e `<APP_URL>/**` tra i Redirect URLs, template
"Invite user" con un testo adatto anche a Sardesk.

### Migrazione 0006 (una volta)
1. Supabase → SQL Editor → esegui `supabase/migrations/0006_organizations.sql`. È idempotente: crea l'organizzazione
   "Sardesk", rende **owner** il primo utente di `wa_admins` (in ordine di creazione) e **admin** gli altri, assegna tutti
   i clienti a Sardesk. Alla fine stampa un riepilogo (membri, owner, clienti).
2. Deploy delle funzioni: `chat`, `ingest`, `generate-report`, `send-report`, `send-invite` (nuova) e redeploy del crawler.
3. Il frontend (Vercel) funziona anche prima della migrazione (modalità compatibile: accesso come prima).

**Tornare indietro**: esegui `supabase/migrations/0006_organizations_rollback.sql` (rimette l'accesso "solo wa_admins",
non cancella dati) e ripubblica la versione precedente di funzioni e crawler. `wa_is_admin()` resta disponibile in entrambi i casi.

## Sviluppo locale
```bash
npm install
cp .env.example .env   # compila VITE_*
npm run dev
```
Crawler locale: `cd crawler && pip install -r requirements.txt && playwright install chromium && uvicorn main:app --reload`.

## Note tecniche
- RLS: solo gli admin (`wa_is_admin()`, cioè `auth.uid()` in `wa_admins`) accedono alle tabelle e al bucket `wa-documents`.
  Widget e canali passano solo dalle edge functions (service role). Edge functions admin e crawler verificano JWT **e** appartenenza a `wa_admins` (altrimenti 403).
- Il crawler scrive direttamente su Supabase (REST, service role). Pagine con contenuto invariato (hash) non vengono ri-embeddate.
- `wa_match_chunks` usa similarità coseno su HNSW; la soglia di confidenza per cliente decide quando il bot "non sa".
- Per aggiungere un modello: una riga in `src/lib/models.js` (provider/id). Provider supportati in `supabase/functions/_shared/common.ts`.

## Database condiviso
Sardesk vive nel progetto Supabase **wisinvaders**, insieme ad altre app. Per isolarlo:
- tutto ciò che crea ha prefisso `wa_`: tabelle (`wa_clients`, `wa_pages`, `wa_chunks`, `wa_crawl_jobs`, `wa_conversations`, `wa_messages`,
  `wa_leads`, `wa_reports`, `wa_rate_limits`, `wa_admins`), vista `wa_client_stats`, funzioni `wa_match_chunks`, `wa_check_rate_limit`,
  `wa_is_admin`, `wa_touch_updated_at`, `wa_on_message_insert`, trigger, indici, policy, job cron (`wa_reports`, `wa_ratelimit_cleanup`, `wa_recrawl`)
  e bucket storage `wa-documents` (privato) e `wa-avatars` (pubblico in lettura, immagini del widget);
- le migration creano/sostituiscono/eliminano **solo** oggetti `wa_`: mai toccare tabelle, funzioni o policy di altre app.
