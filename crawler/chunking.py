"""Markdown chunking that preserves the heading hierarchy and produces an anchor slug per section.

Each chunk → {content, heading_path, anchor}
  - heading_path: "H1 > H2 > H3" (the context the assistant can mention: "nella sezione Prezzi")
  - anchor: slug of the deepest heading; the crawler maps it to the real `id` found in the HTML, so the
    assistant can link to https://site/page#real-id. If no id exists, the chunk keeps url only.
"""
from __future__ import annotations

import re
import unicodedata

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
LINK_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")
NOISE_LINE = re.compile(r"^\s*(\[[^\]]*\]\([^)]*\)\s*)+\s*$")  # lines that are only links (menus)


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:80]


def clean_markdown(md: str) -> str:
    out = []
    for line in md.splitlines():
        line = LINK_IMG.sub("", line)
        if NOISE_LINE.match(line):
            continue
        out.append(line.rstrip())
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_markdown(md: str, title: str = "", max_chars: int = 1400, min_chars: int = 120) -> list[dict]:
    text = clean_markdown(md)
    lines = text.splitlines()
    stack: list[tuple[int, str]] = []
    buf: list[str] = []
    chunks: list[dict] = []

    def heading_path() -> str:
        return " > ".join(t for _, t in stack)

    def flush():
        nonlocal buf
        body = "\n".join(buf).strip()
        buf = []
        if not body:
            return
        hp = heading_path()
        anchor = slugify(stack[-1][1]) if stack else None
        prefix = (hp + "\n\n") if hp else ""
        paras = re.split(r"\n\s*\n", body)
        cur = ""
        for p in paras:
            if len(cur) + len(p) + 2 > max_chars and cur:
                chunks.append({"content": prefix + cur.strip(), "heading_path": hp, "anchor": anchor})
                cur = p
            else:
                cur = f"{cur}\n\n{p}" if cur else p
        # very long single paragraphs → hard split
        while len(cur) > max_chars * 1.5:
            cut = cur.rfind(". ", 0, max_chars) or max_chars
            cut = cut if cut > min_chars else max_chars
            chunks.append({"content": prefix + cur[: cut + 1].strip(), "heading_path": hp, "anchor": anchor})
            cur = cur[cut + 1 :]
        if cur.strip():
            chunks.append({"content": prefix + cur.strip(), "heading_path": hp, "anchor": anchor})

    for line in lines:
        m = HEADING.match(line)
        if m:
            flush()
            level = len(m.group(1))
            htext = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", m.group(2)).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, htext))
        else:
            buf.append(line)
    flush()

    # merge tiny chunks into the previous one (same page) so retrieval isn't polluted by stubs
    merged: list[dict] = []
    for c in chunks:
        same_section = merged and merged[-1]["heading_path"] == c["heading_path"]
        tiny = len(c["content"]) - len(c["heading_path"]) < 12  # heading with no real body
        if merged and (same_section or tiny) and len(c["content"]) < min_chars and len(merged[-1]["content"]) + len(c["content"]) < max_chars * 1.3:
            merged[-1]["content"] += "\n\n" + c["content"]
        else:
            merged.append(c)

    if title:
        for c in merged:
            if not c["heading_path"]:
                c["content"] = f"{title}\n\n{c['content']}"
    return merged
