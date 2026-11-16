"""
WISI Assistant — crawler service (Crawl4AI + FastAPI), deployed on Railway/Render.

Endpoints (Bearer = Supabase user JWT, verified against Supabase Auth; the user must be in wa_admins):
  POST /map    {client_id, url}            → discovers every URL of the site (sitemap + link discovery), no content download
  POST /crawl  {client_id, urls: [...]}    → background job: fetch → markdown → chunk (heading hierarchy + anchors) → embed → Supabase
  GET  /health

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, CRAWLER_SECRET (optional shared secret), PORT
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import sys
from collections import Counter
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, unquote, urlencode, urldefrag, urljoin, urlparse, urlunparse
from xml.etree import ElementTree as ET

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chunking import chunk_markdown, slugify

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s [crawler] %(message)s", force=True)
log = logging.getLogger("crawler")

_QUOTES = "\"'`"


def env(name: str, default: str = "") -> str:
    """Reads an env var stripping whitespace, newlines and surrounding quotes (common copy/paste mistakes)."""
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    while v and (v[0] in _QUOTES or v[-1] in _QUOTES):
        v = v.strip(_QUOTES).strip()
    return v


SUPABASE_URL = env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
OPENAI_KEY = env("OPENAI_API_KEY")
CRAWLER_SECRET = env("CRAWLER_SECRET")
CONCURRENCY = int(env("CRAWL_CONCURRENCY") or "4")
MAP_MAX_PAGES = int(env("MAP_MAX_PAGES") or "20000")  # safety cap for discovery only (no page limit for crawling)


def log_env_diagnostics() -> None:
    """Logs which variables are configured, never their values (only the OpenAI key prefix and length)."""
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "CRAWLER_SECRET", "CRAWL_CONCURRENCY", "MAP_MAX_PAGES", "PORT"):
        raw = os.environ.get(name)
        if raw is None:
            log.info("env %s: MISSING", name)
            continue
        cleaned = env(name)
        log.info("env %s: present%s%s", name, "" if cleaned else " but EMPTY",
                 " (cleaned spaces/newlines/quotes)" if cleaned != raw else "")
    if OPENAI_KEY:
        log.info("env OPENAI_API_KEY: prefix=%r length=%d", OPENAI_KEY[:7], len(OPENAI_KEY))
    log.info("config: concurrency=%d map_max_pages=%d", CONCURRENCY, MAP_MAX_PAGES)


log_env_diagnostics()
if not SUPABASE_URL or not SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono obbligatorie")

app = FastAPI(title="WISI Assistant crawler")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SB_HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json"}


# ----------------------------------------------------------------------------- auth
async def require_admin(authorization: str = Header(default="")):
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(401, "Token mancante")
    if CRAWLER_SECRET and token == CRAWLER_SECRET:
        return {"service": True}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{SUPABASE_URL}/auth/v1/user", headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "Non autorizzato")
    user = r.json()
    # shared DB: a valid JWT is not enough, the user must be listed in wa_admins
    if not user.get("id") or not await sb("GET", "wa_admins", params={"user_id": f"eq.{user['id']}", "select": "user_id"}):
        raise HTTPException(403, "Accesso non autorizzato")
    return user


# ----------------------------------------------------------------------------- supabase helpers
async def sb(method: str, path: str, *, json: Any = None, params: dict | None = None, prefer: str | None = None) -> Any:
    headers = dict(SB_HEADERS)
    if prefer:
        headers["Prefer"] = prefer
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.request(method, f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, json=json, params=params)
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


async def get_client(client_id: str) -> dict:
    rows = await sb("GET", "wa_clients", params={"id": f"eq.{client_id}", "select": "*"})
    if not rows:
        raise HTTPException(404, "Cliente non trovato")
    return rows[0]


# ----------------------------------------------------------------------------- embeddings
async def embed(texts: list[str]) -> list[list[float]]:
    if not OPENAI_KEY:
        raise RuntimeError("OPENAI_API_KEY mancante")
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=120) as c:
        for i in range(0, len(texts), 64):
            batch = [t[:8000] for t in texts[i : i + 64]]
            last_err = ""
            for attempt in range(4):
                r = await c.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                    json={"model": "text-embedding-3-small", "input": batch},
                )
                if r.status_code < 300:
                    out.extend(d["embedding"] for d in r.json()["data"])
                    break
                last_err = openai_error(r)
                log.warning("OpenAI embeddings failed (attempt %d/4): %s", attempt + 1, last_err)
                if r.status_code == 429 or r.status_code >= 500:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                raise RuntimeError(last_err)
            else:
                raise RuntimeError(f"Embedding API non disponibile: {last_err}")
    return out


def openai_error(r: httpx.Response) -> str:
    """Readable error from an OpenAI response body (message + code), not just the HTTP status."""
    msg = code = None
    try:
        err = (r.json() or {}).get("error") or {}
        if isinstance(err, dict):
            msg, code = err.get("message"), err.get("code") or err.get("type")
        else:
            msg = str(err)
    except Exception:
        msg = (r.text or "").strip()[:300] or None
    out = f"OpenAI {r.status_code}"
    if code:
        out += f" [{code}]"
    if msg:
        out += f" {str(msg)[:400]}"
    return out


# ----------------------------------------------------------------------------- patterns
def _pattern_re(p: str) -> re.Pattern:
    return re.compile("^" + re.escape(p).replace(r"\*", ".*"), re.I)


def allowed_by_rules(url: str, include: list[str], exclude: list[str]) -> bool:
    path = urlparse(url).path or "/"

    def match(p: str) -> bool:
        return bool(_pattern_re(p).match(path if p.startswith("/") else url))

    if any(match(p) for p in exclude):
        return False
    if include and not any(match(p) for p in include):
        return False
    return True


SKIP_EXT = re.compile(r"\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|zip|rar|7z|gz|mp4|mp3|wav|avi|mov|woff2?|ttf|eot|pdf|docx?|xlsx?|pptx?)(\?.*)?$", re.I)
SKIP_PATH = re.compile(r"/(wp-admin|wp-json|wp-login|cart|checkout|account|login|logout|feed|xmlrpc\.php|cdn-cgi)(/|$)", re.I)


# tracking / session params that never change the content of a page
TRACKING_PARAM = re.compile(
    r"^(utm_\w*|_gl|_ga|_gac|_hsenc|_hsmi|__hs\w*|hsctatracking|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|yclid|"
    r"mc_cid|mc_eid|igshid|srsltid|_kx|ref|ref_src|referrer|sessionid|phpsessid|jsessionid|replytocom)$",
    re.I,
)
# characters that never appear in a clean URL (spaces, quotes, broken HTML like `/" target=`)
DIRTY_URL = re.compile(r"[\s\"'<>{}|\\^`]")
# "www.site.it/fr/offres" or "site.it/page" written without scheme
DOMAIN_LIKE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?::\d+)?(?:[/?#]|$)", re.I)
HAS_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)


def _bare_host(h: str | None) -> str:
    return (h or "").lower().split(":")[0].removeprefix("www.")


def normalize(url: str, base: str, site: str | None = None) -> str | None:
    """Cleans a URL found in a sitemap/href/canonical. With `site`, same-site URLs get the site's scheme+host
    (so http/https and www/non-www variants collapse into one URL)."""
    try:
        raw = (url or "").strip()
        if not raw or DIRTY_URL.search(raw):
            return None
        # "www.hotel.it/fr/offres" in an href is an absolute URL written without scheme, not a relative path
        if not raw.startswith(("/", ".", "?", "#")) and not raw.lower().startswith(("http://", "https://")):
            host_part = re.split(r"[/?#]", raw, maxsplit=1)[0].lower()
            site_host = _bare_host(urlparse(site or base).hostname)
            if DOMAIN_LIKE.match(raw) and (host_part.startswith("www.") or _bare_host(host_part) == site_host):
                raw = "https://" + raw
            elif HAS_SCHEME.match(raw) and not raw.lower().startswith(("http:", "https:")):
                return None  # mailto:, tel:, javascript:, data:, …
        u, _ = urldefrag(urljoin(base, raw))
        p = urlparse(u)
        if p.scheme not in ("http", "https") or not p.hostname:
            return None
        if DIRTY_URL.search(unquote(p.path)) or DIRTY_URL.search(unquote(p.query)):
            return None  # encoded spaces/quotes: "%20target=" and similar garbage
        if SKIP_EXT.search(p.path) or SKIP_PATH.search(p.path):
            return None
        scheme, host = p.scheme, p.hostname.lower()
        port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
        if site and same_site(u, site):
            sp = urlparse(site)
            scheme, host, port = sp.scheme or scheme, (sp.hostname or host).lower(), f":{sp.port}" if sp.port and sp.port not in (80, 443) else ""
        q = urlencode(sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=False) if not TRACKING_PARAM.match(k)), doseq=True)
        path = re.sub(r"/{2,}", "/", p.path or "/")
        if path != "/":
            path = path.rstrip("/") or "/"
        return urlunparse((scheme, host + port, path, "", q, ""))
    except Exception:
        return None


def same_site(u: str, root: str) -> bool:
    return _bare_host(urlparse(u).hostname) == _bare_host(urlparse(root).hostname)


def canonical_url(html: str, page_url: str) -> str | None:
    """Same-site <link rel="canonical"> of a page, normalized; None if missing or unusable."""
    if not html:
        return None
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for link in soup.find_all("link", href=True):
            rel = link.get("rel") or []
            rel = rel if isinstance(rel, list) else str(rel).split()
            if "canonical" not in [r.lower() for r in rel]:
                continue
            c = normalize(link["href"], page_url, site=page_url)
            if not c or not same_site(c, page_url):
                return None
            # misconfigured sites point every page's canonical to the homepage: ignore that
            if urlparse(c).path in ("", "/") and urlparse(page_url).path not in ("", "/"):
                return None
            return c
    except Exception:
        return None
    return None


NOT_FOUND_TITLE = re.compile(
    r"\b404\b|not\s+found|page\s+introuvable|introuvable|non\s+trouv[ée]e|pagina\s+non\s+(?:trovata|esistente|disponibile)|"
    r"nicht\s+gefunden|seite\s+existiert\s+nicht|p[áa]gina\s+no\s+encontrada|no\s+encontrad[ao]|niet\s+gevonden|error\s+404",
    re.I,
)
NOT_FOUND_BODY = re.compile(
    r"\b(?:error|errore|fehler|erreur)\s*404\b|\b404\b\s*[-–:|]?\s*(?:page|pagina|seite|not|non|nicht)|page\s+not\s+found|"
    r"the\s+page\s+you\s+(?:are|were)\s+looking\s+for|pagina\s+non\s+(?:trovata|esistente)|la\s+pagina\s+(?:che\s+)?(?:stai\s+)?cerca\w*\s+non|"
    r"seite\s+(?:wurde\s+)?nicht\s+gefunden|page\s+introuvable|page\s+non\s+trouv[ée]e|p[áa]gina\s+no\s+encontrada",
    re.I,
)


def looks_not_found(title: str, md: str, status_code: int | None) -> str | None:
    """Detects real and 'soft' 404 pages (HTTP 200 with a 'page not found' template). Returns a reason or None."""
    if status_code in (404, 410):
        return f"Pagina non trovata (HTTP {status_code})"
    if title and NOT_FOUND_TITLE.search(title):
        return f"Pagina non trovata (titolo: {title[:80]})"
    text = (md or "").strip()
    # only short pages: a long article that merely mentions "404" is not an error page
    if text and len(text.split()) < 250 and NOT_FOUND_BODY.search(text[:1500]):
        return "Pagina non trovata (contenuto da pagina 404)"
    return None


# ----------------------------------------------------------------------------- MAP (discovery)
class MapReq(BaseModel):
    client_id: str
    url: str


async def fetch_sitemap_urls(root: str, client: httpx.AsyncClient) -> set[str]:
    found: set[str] = set()
    candidates = [urljoin(root, "/sitemap.xml"), urljoin(root, "/sitemap_index.xml"), urljoin(root, "/sitemap-index.xml"), urljoin(root, "/wp-sitemap.xml")]
    try:
        r = await client.get(urljoin(root, "/robots.txt"))
        if r.status_code == 200:
            candidates += [l.split(":", 1)[1].strip() for l in r.text.splitlines() if l.lower().startswith("sitemap:")]
    except Exception:
        pass
    seen: set[str] = set()

    async def parse(sm: str, depth: int = 0):
        if sm in seen or depth > 3 or len(found) > MAP_MAX_PAGES:
            return
        seen.add(sm)
        try:
            r = await client.get(sm)
            if r.status_code != 200 or "xml" not in r.headers.get("content-type", "") and not r.text.lstrip().startswith("<?xml"):
                return
            tree = ET.fromstring(r.content)
        except Exception:
            return
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        for loc in tree.findall(".//s:sitemap/s:loc", ns):
            await parse(loc.text.strip(), depth + 1)
        for loc in tree.findall(".//s:url/s:loc", ns):
            u = normalize(loc.text or "", root, site=root)
            if u and same_site(u, root):
                found.add(u)

    for c in candidates:
        await parse(c)
    return found


async def discover_links(root: str, client: httpx.AsyncClient, seed: set[str]) -> set[str]:
    """BFS over internal links (HTML only, HEAD-less). Stops at MAP_MAX_PAGES."""
    from bs4 import BeautifulSoup

    found: set[str] = set(seed)
    queue: list[str] = [normalize(root, root, site=root) or root] + [u for u in seed][:500]
    visited: set[str] = set()
    sem = asyncio.Semaphore(8)

    async def visit(u: str):
        async with sem:
            try:
                r = await client.get(u, follow_redirects=True)
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    return []
                soup = BeautifulSoup(r.text, "html.parser")
                out = []
                for a in soup.find_all("a", href=True):
                    n = normalize(a["href"], str(r.url), site=root)
                    if n and same_site(n, root):
                        out.append(n)
                return out
            except Exception:
                return []

    while queue and len(found) < MAP_MAX_PAGES:
        batch, queue = queue[:32], queue[32:]
        batch = [u for u in batch if u not in visited]
        visited.update(batch)
        results = await asyncio.gather(*(visit(u) for u in batch))
        for links in results:
            for l in links:
                if l not in found:
                    found.add(l)
                    queue.append(l)
    return found


@app.post("/map")
async def map_site(req: MapReq, _=Depends(require_admin)):
    client = await get_client(req.client_id)
    root = req.url if req.url.startswith("http") else f"https://{req.url}"
    await sb("PATCH", "wa_clients", params={"id": f"eq.{req.client_id}"}, json={"status": "mapping"})
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "WISI-Assistant-Crawler/1.0"}) as c:
            # follow redirects once so every URL uses the site's real scheme + host (www vs non-www, http vs https)
            try:
                r0 = await c.get(root, follow_redirects=True)
                if same_site(str(r0.url), root):
                    fu = urlparse(str(r0.url))
                    root = f"{fu.scheme}://{fu.netloc}/"
            except Exception:
                pass
            urls = await fetch_sitemap_urls(root, c)
            urls = await discover_links(root, c, urls)
        # All URLs are returned; the dashboard shows which ones are excluded by the saved rules
        # (so the admin can see what is being filtered and adjust the rules).
        urls = sorted(urls)
        return {"urls": urls, "count": len(urls), "excluded": sum(1 for u in urls if not allowed_by_rules(u, client.get("include_patterns") or [], client.get("exclude_patterns") or []))}
    finally:
        prev = client["status"] if client["status"] != "mapping" else "new"
        await sb("PATCH", "wa_clients", params={"id": f"eq.{req.client_id}"}, json={"status": prev})


# ----------------------------------------------------------------------------- CRAWL
class CrawlReq(BaseModel):
    client_id: str
    urls: list[str]


@app.post("/crawl")
async def crawl(req: CrawlReq, bg: BackgroundTasks, _=Depends(require_admin)):
    client = await get_client(req.client_id)
    urls = sorted({u for u in req.urls if u.startswith("http")})
    if not urls:
        raise HTTPException(400, "Nessun URL")
    running = await sb("GET", "wa_crawl_jobs", params={"client_id": f"eq.{req.client_id}", "status": "in.(queued,running)", "select": "id"})
    if running:
        raise HTTPException(409, "Un crawl è già in corso per questo cliente")
    job = (await sb("POST", "wa_crawl_jobs", json={"client_id": req.client_id, "status": "queued", "total_count": len(urls)}, prefer="return=representation"))[0]
    bg.add_task(run_crawl, client, job["id"], urls)
    return {"job_id": job["id"], "count": len(urls)}


async def run_crawl(client: dict, job_id: str, urls: list[str]):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
    try:
        from crawl4ai.content_filter_strategy import PruningContentFilterLXML as PruningFilter
    except ImportError:  # older crawl4ai
        from crawl4ai.content_filter_strategy import PruningContentFilter as PruningFilter

    cid = client["id"]
    t0 = time.time()
    log.info("crawl START job=%s client=%s pages=%d", job_id, cid, len(urls))
    await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "running", "started_at": now()})
    await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "crawling"})
    done = errors = 0
    reasons: Counter[str] = Counter()
    seen_canonical: dict[str, str] = {}  # canonical URL → first crawled URL in this job
    sem = asyncio.Semaphore(CONCURRENCY)

    md_gen = DefaultMarkdownGenerator(content_filter=PruningFilter(threshold=0.45, threshold_type="dynamic", min_word_threshold=8))
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        markdown_generator=md_gen,
        excluded_tags=["nav", "footer", "header", "aside", "script", "style", "form", "noscript"],
        remove_overlay_elements=True,
        page_timeout=45000,
        word_count_threshold=5,
    )
    browser_cfg = BrowserConfig(headless=True, verbose=False, text_mode=True)

    try:
        async with AsyncWebCrawler(config=browser_cfg) as crawler:

            async def one(u: str):
                async with sem:
                    try:
                        await crawl_one(u)
                    finally:
                        await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"done_count": done, "error_count": errors})

            async def crawl_one(u: str):
                nonlocal done, errors
                try:
                    await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"current_url": u})
                    res = await crawler.arun(url=u, config=run_cfg)
                    if not res.success:
                        raise RuntimeError(res.error_message or "fetch failed")
                    md_obj = res.markdown
                    # Crawl4AI ≥0.5 returns a MarkdownGenerationResult; older returns str
                    fit = getattr(md_obj, "fit_markdown", None) or getattr(md_obj, "raw_markdown", None) or str(md_obj or "")
                    raw = getattr(md_obj, "raw_markdown", None) or str(md_obj or "")
                    md = fit if fit and len(fit) > 200 else raw
                    title = (res.metadata or {}).get("title") or ""
                    final_url = getattr(res, "redirected_url", None) or u
                    page_url = canonical_url(res.html or "", final_url) or normalize(final_url, final_url, site=u) or u
                    if page_url != u:
                        log.info("crawl canonical job=%s %s -> %s", job_id, u, page_url)
                        # the old row stored under the non-canonical URL is a duplicate: drop it (chunks cascade)
                        await sb("DELETE", "wa_pages", params={"client_id": f"eq.{cid}", "url": f"eq.{u}", "kind": "eq.page"})
                    if page_url in seen_canonical:
                        log.info("crawl duplicate job=%s %s is the same page as %s, skipped", job_id, u, seen_canonical[page_url])
                        done += 1
                        return
                    seen_canonical[page_url] = u
                    not_found = looks_not_found(title, md, getattr(res, "status_code", None))
                    if not_found:
                        log.info("crawl page EMPTY job=%s url=%s reason=%s", job_id, page_url, not_found)
                        await mark_empty(cid, page_url, title, len(md.split()), not_found)
                        done += 1
                        return
                    anchors = extract_anchor_map(res.html or "")
                    await index_page(cid, page_url, title, md, anchors)
                    done += 1
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    reason = (str(e) or type(e).__name__).strip()
                    reasons[reason.splitlines()[0][:200]] += 1
                    log.warning("crawl page FAILED job=%s url=%s error=%s", job_id, u, reason[:500])
                    try:
                        await upsert_page(cid, u, {"status": "failed", "error": reason[:300], "last_crawled_at": now()})
                    except Exception as e2:  # noqa: BLE001
                        log.error("could not save page error job=%s url=%s: %s", job_id, u, e2)

            await asyncio.gather(*(one(u) for u in urls))
        elapsed = time.time() - t0
        if done == 0 and errors > 0:
            top, n = reasons.most_common(1)[0] if reasons else ("errore sconosciuto", errors)
            msg = f"Tutte le {errors} pagine sono fallite. Motivo principale ({n}/{errors}): {top}"
            log.error("crawl END job=%s status=error done=0 errors=%d in %.1fs: %s", job_id, errors, elapsed, msg)
            await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "error", "finished_at": now(), "current_url": None, "done_count": done, "error_count": errors, "error": msg[:500]})
            await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "error"})
            return
        await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "done", "finished_at": now(), "current_url": None, "done_count": done, "error_count": errors})
        await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "ready", "last_crawl_at": now()})
        log.info("crawl END job=%s status=done done=%d errors=%d in %.1fs%s", job_id, done, errors, elapsed,
                 f" (top error: {reasons.most_common(1)[0][0]})" if reasons else "")
    except Exception as e:  # noqa: BLE001
        log.exception("crawl END job=%s status=error (crash) done=%d errors=%d in %.1fs", job_id, done, errors, time.time() - t0)
        await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "error", "finished_at": now(), "current_url": None, "error": (str(e) or type(e).__name__)[:500]})
        await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "error"})


def extract_anchor_map(html: str) -> dict[str, str]:
    """Maps normalized heading text → real id attribute found in the HTML, so links can point to url#id."""
    out: dict[str, str] = {}
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            text = h.get_text(" ", strip=True)
            if not text:
                continue
            hid = h.get("id") or (h.find(attrs={"id": True}) or {}).get("id") or (h.find_parent(attrs={"id": True}) or {}).get("id")
            if hid:
                out[slugify(text)] = hid
    except Exception:
        pass
    return out


async def upsert_page(cid: str, url: str, fields: dict) -> dict:
    rows = await sb("POST", "wa_pages", params={"on_conflict": "client_id,url"}, json={"client_id": cid, "url": url, "kind": "page", **fields}, prefer="resolution=merge-duplicates,return=representation")
    return rows[0]


async def mark_empty(cid: str, url: str, title: str, words: int, reason: str | None) -> None:
    """Page with nothing to index (too short, 404…): keep the row for visibility, remove any old chunks."""
    page = await upsert_page(cid, url, {"title": title, "status": "empty", "chunk_count": 0, "word_count": words, "content_hash": None, "error": reason, "last_crawled_at": now()})
    await sb("DELETE", "wa_chunks", params={"page_id": f"eq.{page['id']}"})


async def index_page(cid: str, url: str, title: str, md: str, anchors: dict[str, str]):
    text = (md or "").strip()
    words = len(text.split())
    if words < 20:
        await mark_empty(cid, url, title, words, None)
        return
    h = hashlib.sha256(text.encode()).hexdigest()[:32]
    existing = await sb("GET", "wa_pages", params={"client_id": f"eq.{cid}", "url": f"eq.{url}", "select": "id,content_hash"})
    if existing and existing[0].get("content_hash") == h:
        await upsert_page(cid, url, {"title": title, "status": "ok", "error": None, "last_crawled_at": now()})
        return  # unchanged → skip re-embedding (saves money)

    page = await upsert_page(cid, url, {"title": title, "status": "pending", "error": None})
    chunks = chunk_markdown(text, title=title, max_chars=1400)
    vecs = await embed([c["content"] for c in chunks])
    rows = []
    for i, (c, v) in enumerate(zip(chunks, vecs)):
        anchor = anchors.get(c["anchor"]) if c["anchor"] else None
        rows.append({
            "client_id": cid, "page_id": page["id"], "idx": i, "content": c["content"], "url": url,
            "anchor": anchor, "heading_path": c["heading_path"], "title": title, "embedding": v, "token_count": len(c["content"]) // 4,
        })
    await sb("DELETE", "wa_chunks", params={"page_id": f"eq.{page['id']}"})
    for i in range(0, len(rows), 50):
        await sb("POST", "wa_chunks", json=rows[i : i + 50])
    await upsert_page(cid, url, {"status": "ok", "chunk_count": len(rows), "word_count": words, "content_hash": h, "error": None, "last_crawled_at": now()})


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
async def health():
    return {"ok": True, "time": time.time()}
