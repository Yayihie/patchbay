#!/usr/bin/env python3
"""Pull competitor product pages via scrapling's HTTP fetcher and save text."""
import re
import html as htmllib
from pathlib import Path

from scrapling.fetchers import Fetcher

OUT = Path(__file__).resolve().parent

# (slug, url, label)
TARGETS = [
    ("langflow", "https://www.langflow.org/", "Langflow home"),
    ("langflow-docs", "https://docs.langflow.org/starter-basics/overview", "Langflow docs overview"),
    ("flowise", "https://flowiseai.com/", "Flowise home"),
    ("n8n", "https://n8n.io/", "n8n home"),
    ("n8n-ai", "https://docs.n8n.io/advanced-ai/intro-tutorial/", "n8n advanced AI docs"),
    ("dify", "https://dify.ai/", "Dify home"),
    ("activepieces", "https://activepieces.com/", "Activepieces home"),
    ("windmill", "https://www.windmill.dev/", "Windmill home"),
    ("lindy", "https://www.lindy.ai/", "Lindy home"),
    ("gumloop", "https://www.gumloop.com/", "Gumloop home"),
    ("zapier-agents", "https://zapier.com/agents", "Zapier Agents"),
    ("make", "https://www.make.com/en", "Make home"),
    ("relevance", "https://www.relevanceai.com/", "Relevance AI home"),
]

TAG = re.compile(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", re.S | re.I)
ANYTAG = re.compile(r"<[^>]+>")
WS = re.compile(r"[ \t]+")
BLANK = re.compile(r"\n\s*\n+")


def to_text(raw: str) -> str:
    t = TAG.sub(" ", raw)
    t = ANYTAG.sub("\n", t)
    t = htmllib.unescape(t)
    t = "\n".join(WS.sub(" ", ln).strip() for ln in t.splitlines())
    t = BLANK.sub("\n\n", t)
    return t.strip()


def main() -> None:
    summary = []
    for slug, url, label in TARGETS:
        try:
            page = Fetcher.get(url, stealthy_headers=True, timeout=30)
            raw = page.html_content if hasattr(page, "html_content") else str(page.body)
            text = to_text(raw)
            path = OUT / f"{slug}.txt"
            path.write_text(f"URL: {url}\nLABEL: {label}\nCHARS: {len(text)}\n\n{text}")
            summary.append(f"{label:<26} {len(text):>7} chars  -> {path.name}")
        except Exception as exc:  # report, don't hide
            summary.append(f"{label:<26} FAILED: {exc}")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
