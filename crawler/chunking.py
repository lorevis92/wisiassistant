"""Structure-aware chunking for site pages (and the same rules in TypeScript for manual content: _shared/common.ts).

Each chunk → {content, heading_path, anchor}
  - content starts with a context header: "Pagina: <title>" + "Sezione: <H1 > H2 > H3>" so every chunk can be understood
    (and found) on its own, even when the section text never repeats the topic ("Dalle 9 alle 18" under "Orari").
  - sections are split by headings; small sibling sections (FAQ items, accordion panels, short cards) are kept together
    up to the size limit, each with its own heading line, so related facts stay in one chunk.
  - long sections are split by paragraph with a short overlap (the last paragraph is repeated in the next chunk).
  - tables and lists are never cut in the middle of a row/item; a long table is split by rows and every part repeats
    the header row, so prices/hours keep their column names.
  - heading_path: "H1 > H2 > H3"; anchor: slug of the deepest heading (the crawler maps it to the real HTML id).

CHUNKER_VERSION is part of the page fingerprint: changing the rules makes the next crawl re-embed every page once.
"""
from __future__ import annotations

import re
import unicodedata

CHUNKER_VERSION = "3"

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
LINK_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")
NOISE_LINE = re.compile(r"^\s*([-*•]\s*)?(\[[^\]]*\]\([^)]*\)\s*[|·•/-]?\s*)+\s*$")  # lines that are only links (menus)
MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]*)[^)]*\)")
BOILERPLATE = re.compile(
    r"(cookie|privacy policy|informativa sulla privacy|tutti i diritti riservati|all rights reserved|p\.?\s?iva|skip to (main )?content|"
    r"vai al contenuto|torna su|back to top|seguici su|follow us|iscriviti alla newsletter|subscribe to our newsletter)",
    re.I,
)
TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:80]


def clean_markdown(md: str) -> str:
    """Drops images, link-only lines (menus, breadcrumbs), short boilerplate lines and repeated lines; keeps link text."""
    out: list[str] = []
    seen: set[str] = set()
    for line in md.splitlines():
        line = LINK_IMG.sub("", line).rstrip()
        if NOISE_LINE.match(line):
            continue
        plain = MD_LINK.sub(r"\1", line).strip()
        if plain and len(plain) < 140 and BOILERPLATE.search(plain):
            continue
        # keep link text, drop link targets (they only add noise to embeddings; the page URL travels with the chunk)
        line = MD_LINK.sub(r"\1", line)
        key = re.sub(r"\s+", " ", plain.lower())
        if key and len(key) > 25 and not TABLE_ROW.match(line) and not HEADING.match(line):
            if key in seen:  # the same sentence repeated on the page (sticky banners, duplicated mobile/desktop blocks)
                continue
            seen.add(key)
        out.append(line)
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


LIST_ITEM = re.compile(r"^\s*([-*+•]|\d+[.)])\s+")


def _blocks(body: str) -> list[str]:
    """Paragraph blocks. A table or a list is one block (blank lines inside it are ignored); a short lead-in line
    ("Orari di apertura:") stays attached to the list or table that follows it."""
    blocks: list[str] = []
    cur: list[str] = []
    kind: str | None = None

    def close():
        nonlocal cur, kind
        if cur:
            blocks.append("\n".join(cur).strip())
        cur, kind = [], None

    for line in body.splitlines():
        if not line.strip():
            if kind in ("table", "list"):
                continue
            close()
            continue
        k = "table" if TABLE_ROW.match(line) else "list" if LIST_ITEM.match(line) else "text"
        if kind == "list" and k == "text" and line[:1] in (" ", "\t"):
            k = "list"  # indented continuation of a list item
        if kind is None:
            kind = k
        elif k != kind:
            if kind == "text" and k in ("list", "table") and len(cur) <= 2 and len(" ".join(cur)) < 220:
                kind = k  # lead-in sentence stays with its list / table
            else:
                close()
                kind = k
        cur.append(line)
    close()
    return [b for b in blocks if b]


def _split_table(block: str, max_chars: int) -> list[str]:
    rows = block.splitlines()
    head = rows[:2] if len(rows) > 1 and TABLE_SEP.match(rows[1]) else rows[:1]
    body = rows[len(head):]
    parts, cur = [], list(head)
    for r in body:
        if sum(len(x) + 1 for x in cur) + len(r) > max_chars and len(cur) > len(head):
            parts.append("\n".join(cur)); cur = list(head)
        cur.append(r)
    parts.append("\n".join(cur))
    return parts


def _split_long(block: str, max_chars: int) -> list[str]:
    if len(block) <= max_chars:
        return [block]
    if TABLE_ROW.match(block.splitlines()[0]):
        return _split_table(block, max_chars)
    lines = block.splitlines()
    if len(lines) > 1:  # lists / multi-line blocks: split between lines
        parts, cur = [], ""
        for ln in lines:
            if cur and len(cur) + len(ln) + 1 > max_chars:
                parts.append(cur); cur = ln
            else:
                cur = f"{cur}\n{ln}" if cur else ln
        return parts + ([cur] if cur else [])
    parts, cur = [], block  # one huge paragraph: cut at sentence ends
    while len(cur) > max_chars:
        cut = cur.rfind(". ", 0, max_chars)
        cut = cut + 1 if cut > max_chars // 3 else max_chars
        parts.append(cur[:cut].strip()); cur = cur[cut:].strip()
    return parts + ([cur] if cur else [])


def chunk_markdown(md: str, title: str = "", max_chars: int = 1800, min_chars: int = 220, overlap_chars: int = 320) -> list[dict]:
    text = clean_markdown(md)
    # 1. sections: (heading_path, deepest heading, level, body)
    stack: list[tuple[int, str]] = []
    sections: list[dict] = []
    buf: list[str] = []

    def push_section():
        body = "\n".join(buf).strip()
        if body or stack:
            sections.append({"path": [t for _, t in stack], "level": stack[-1][0] if stack else 0, "body": body,
                             "anchor": slugify(stack[-1][1]) if stack else None})

    for line in text.splitlines():
        m = HEADING.match(line)
        if m:
            push_section(); buf = []
            level = len(m.group(1))
            htext = MD_LINK.sub(r"\1", m.group(2)).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, htext))
        else:
            buf.append(line)
    push_section()
    sections = [s for s in sections if s["body"]]

    # 2. group small sibling sections (same parent) so related facts stay together
    groups: list[list[dict]] = []
    for s in sections:
        g = groups[-1] if groups else None
        if g:
            parent = g[0]["path"][:-1]
            size = sum(len(x["body"]) + len(x["path"][-1] if x["path"] else "") + 8 for x in g)
            small = min_chars  # FAQ items, accordion panels, short cards
            if s["path"][:-1] == parent and len(s["path"]) == len(g[0]["path"]) and size + len(s["body"]) < max_chars \
                    and len(s["body"]) < small and all(len(x["body"]) < small for x in g):
                g.append(s); continue
        groups.append([s])

    # 3. chunks with context header and overlap
    chunks: list[dict] = []
    for g in groups:
        if len(g) == 1:
            hp = " > ".join(g[0]["path"])
            body_blocks = _blocks(g[0]["body"])
        else:
            hp = " > ".join(g[0]["path"][:-1])
            body_blocks = []
            for s in g:  # keep each sub-heading in the text: "Orari" + "Dalle 9 alle 18"
                body_blocks.append(f"{s['path'][-1]}\n{s['body']}" if s["path"] else s["body"])
        anchor = g[0]["anchor"]
        header = "\n".join(x for x in [f"Pagina: {title}" if title else "", f"Sezione: {hp}" if hp else ""] if x)
        room = max_chars - len(header) - 2
        pieces: list[str] = []
        for b in body_blocks:
            pieces.extend(_split_long(b, room))
        cur: list[str] = []
        for p in pieces:
            if cur and sum(len(x) + 2 for x in cur) + len(p) > room:
                chunks.append({"content": f"{header}\n\n" + "\n\n".join(cur) if header else "\n\n".join(cur), "heading_path": hp, "anchor": anchor})
                last = cur[-1]
                cur = [last] if len(last) <= overlap_chars and not TABLE_ROW.match(last.splitlines()[0]) else []
            cur.append(p)
        if cur:
            chunks.append({"content": f"{header}\n\n" + "\n\n".join(cur) if header else "\n\n".join(cur), "heading_path": hp, "anchor": anchor})

    # 4. a trailing stub (just a few words) joins the previous chunk of the same section
    merged: list[dict] = []
    for c in chunks:
        if merged and merged[-1]["heading_path"] == c["heading_path"] and len(c["content"]) < min_chars \
                and len(merged[-1]["content"]) + len(c["content"]) < max_chars * 1.2:
            body = c["content"].split("\n\n", 1)[-1] if c["content"].startswith("Pagina:") or c["content"].startswith("Sezione:") else c["content"]
            merged[-1]["content"] += "\n\n" + body
        else:
            merged.append(c)
    return merged
