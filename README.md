# WISI Assistant

Piattaforma di customer support AI stile Chatbase, parte del WiSiVERSE.
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
- **Inbox**: escalation automatica (richiesta esplicita o bot senza risposta) con email + handoff live (rispondi tu, su qualsiasi canale).
- **Lead capture**, feedback 👍/👎, domande senza risposta, analytics, domain lock, rate limiting.
- **Report AI periodici**: settimanali/quindicinali/mensili, bozza → modifica → approva → invio (o invio automatico).
- **Canali**: widget sito, pagina standalone `/c/<slug>`, Telegram, WhatsApp Cloud API, Instagram/Messenger (stesso webhook), email.

## Setup (una volta sola)

### 1. Supabase
1. Crea un progetto. SQL Editor → esegui `supabase/migrations/0001_init.sql`.
2. Authentication → Users → **Add user** (la tua email/password: è l'unico login).
3. Project Settings → API: copia `URL`, `anon key`, `service_role key`.
4. Installa la CLI (`npm i -g supabase`), poi:
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... RESEND_API_KEY=re_... \
     REPORT_FROM_EMAIL="WISI Assistant <assistant@tuodominio.com>" PUBLIC_APP_URL=https://assistant.wisiverse.com \
     TELEGRAM_WEBHOOK_SECRET=<stringa-casuale> META_VERIFY_TOKEN=<stringa-casuale>
   supabase functions deploy chat --no-verify-jwt
   supabase functions deploy ingest
   supabase functions deploy generate-report --no-verify-jwt
   supabase functions deploy send-report
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

### 3. Frontend su Vercel
1. Importa il repo. Framework: Vite. Build command `npm run build`, output `dist`.
2. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CRAWLER_URL` (URL Railway).
3. Deploy. Il widget è servito su `https://<dominio>/widget.js`.
   Ricorda: dopo aver aggiunto env var su Vercel serve un redeploy.

### 4. Loghi
Copia in `/public`: `logo-wisiassistant.png` (WISI + "Assistant") e `logo-wisiverse.png` (footer). Se mancano l'app funziona lo stesso (mostra solo il testo).

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

## Sviluppo locale
```bash
npm install
cp .env.example .env   # compila VITE_*
npm run dev
```
Crawler locale: `cd crawler && pip install -r requirements.txt && playwright install chromium && uvicorn main:app --reload`.

## Note tecniche
- RLS: solo utenti autenticati (tu) accedono alle tabelle. Widget e canali passano solo dalle edge functions (service role).
- Il crawler scrive direttamente su Supabase (REST, service role). Pagine con contenuto invariato (hash) non vengono ri-embeddate.
- `match_chunks` usa similarità coseno su HNSW; la soglia di confidenza per cliente decide quando il bot "non sa".
- Per aggiungere un modello: una riga in `src/lib/models.js` (provider/id). Provider supportati in `supabase/functions/_shared/common.ts`.
