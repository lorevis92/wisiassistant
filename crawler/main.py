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
import os
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse, urldefrag
from xml.etree import ElementTree as ET

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chunking import chunk_markdown, slugify

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
CRAWLER_SECRET = os.environ.get("CRAWLER_SECRET", "")
CONCURRENCY = int(os.environ.get("CRAWL_CONCURRENCY", "4"))
MAP_MAX_PAGES = int(os.environ.get("MAP_MAX_PAGES", "20000"))  # safety cap for discovery only (no page limit for crawling)

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
            for attempt in range(4):
                r = await c.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                    json={"model": "text-embedding-3-small", "input": batch},
                )
                if r.status_code == 429 or r.status_code >= 500:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                r.raise_for_status()
                out.extend(d["embedding"] for d in r.json()["data"])
                break
            else:
                raise RuntimeError("Embedding API non disponibile")
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


def normalize(url: str, base: str) -> str | None:
    try:
        u = urljoin(base, url.strip())
        u, _ = urldefrag(u)
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            return None
        if SKIP_EXT.search(p.path) or SKIP_PATH.search(p.path):
            return None
        # drop tracking params
        q = "&".join(x for x in p.query.split("&") if x and not re.match(r"^(utm_|fbclid|gclid|ref=|sessionid)", x, re.I))
        u = p._replace(query=q, fragment="").geturl()
        return u.rstrip("/") if p.path not in ("", "/") else u
    except Exception:
        return None


def same_site(u: str, root: str) -> bool:
    a, b = urlparse(u).hostname or "", urlparse(root).hostname or ""
    a, b = a.lower().removeprefix("www."), b.lower().removeprefix("www.")
    return a == b


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
            u = normalize(loc.text, root)
            if u and same_site(u, root):
                found.add(u)

    for c in candidates:
        await parse(c)
    return found


async def discover_links(root: str, client: httpx.AsyncClient, seed: set[str]) -> set[str]:
    """BFS over internal links (HTML only, HEAD-less). Stops at MAP_MAX_PAGES."""
    from bs4 import BeautifulSoup

    found: set[str] = set(seed)
    queue: list[str] = [root] + [u for u in seed][:500]
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
                    n = normalize(a["href"], str(r.url))
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
    await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "running", "started_at": now()})
    await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "crawling"})
    done = errors = 0
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
                nonlocal done, errors
                async with sem:
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
                        anchors = extract_anchor_map(res.html or "")
                        await index_page(cid, u, title, md, anchors)
                        done += 1
                    except Exception as e:  # noqa: BLE001
                        errors += 1
                        await upsert_page(cid, u, {"status": "failed", "error": str(e)[:300], "last_crawled_at": now()})
                    await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"done_count": done, "error_count": errors})

            await asyncio.gather(*(one(u) for u in urls))
        await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "done", "finished_at": now(), "current_url": None, "done_count": done, "error_count": errors})
        await sb("PATCH", "wa_clients", params={"id": f"eq.{cid}"}, json={"status": "ready", "last_crawl_at": now()})
    except Exception as e:  # noqa: BLE001
        await sb("PATCH", "wa_crawl_jobs", params={"id": f"eq.{job_id}"}, json={"status": "error", "finished_at": now(), "error": str(e)[:500]})
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


async def index_page(cid: str, url: str, title: str, md: str, anchors: dict[str, str]):
    text = (md or "").strip()
    words = len(text.split())
    if words < 20:
        await upsert_page(cid, url, {"title": title, "status": "empty", "chunk_count": 0, "word_count": words, "error": None, "last_crawled_at": now()})
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
