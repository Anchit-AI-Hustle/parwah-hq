#!/usr/bin/env python3
"""Parwah site test suite — run after ANY change; all checks must pass before commit."""
import re, sys, subprocess, tempfile
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
PAGES = [ROOT / "public" / "index.html", ROOT / "public" / "story" / "index.html", ROOT / "public" / "launch" / "index.html", ROOT / "public" / "get" / "index.html"]
FAILS = []

def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  — " + detail) if detail else ""))
    if not ok: FAILS.append(name)

# ---------- 1. HTML well-formedness ----------
class Validator(HTMLParser):
    VOID = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack=[]; self.errors=[]
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack: self.errors.append(f"stray </{tag}>"); return
        if self.stack[-1]==tag: self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1]!=tag: self.errors.append(f"unclosed <{self.stack.pop()}>")
            self.stack.pop()
        else: self.errors.append(f"unmatched </{tag}>")

for p in PAGES:
    v = Validator(); v.feed(p.read_text(encoding="utf-8"))
    errs = v.errors + [f"unclosed <{t}>" for t in v.stack]
    check(f"HTML structure: {p.relative_to(ROOT)}", not errs, "; ".join(errs[:4]))

# ---------- 2. Internal links resolve ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8"); bad = []
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith(("http","mailto:","#")): continue
        target = (p.parent / href.split("#")[0]).resolve()
        if target.is_dir(): target = target / "index.html"
        if not target.exists(): bad.append(href)
    check(f"internal links: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

# ---------- 3. Anchor targets exist ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    ids = set(re.findall(r'id="([^"]+)"', html)); bad = []
    for href in re.findall(r'href="#([^"]+)"', html):
        if href not in ids: bad.append("#"+href)
    check(f"anchor targets: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

# ---------- 4. Banned therapeutic claims (ASCI guardrail) ----------
BANNED = ["cure","treats ","treatment","heals","prevent","reverse","remedy",
          "medicine","therapeutic","clinically proven","doctor recommended",
          "pain relief","arthritis relief","guaranteed result"]
for p in PAGES:
    text = re.sub(r"<[^>]+>"," ", p.read_text(encoding="utf-8")).lower()
    # mandatory legal disclaimer uses negative claim language — exempt it, keep marketing copy strict
    text = text.replace("our products are not medicines and are not intended to diagnose", "")
    hits = sorted({b for b in BANNED if b in text})
    check(f"zero-claims scan: {p.relative_to(ROOT)}", not hits, ", ".join(hits))

# ---------- 5. WhatsApp number guard (real number live; placeholder must never return) ----------
WA_NUMBER = "919873945238"
ph = sum(p.read_text(encoding="utf-8").count("91XXXXXXXXXX") for p in PAGES)
wa = sum(p.read_text(encoding="utf-8").count(f"wa.me/{WA_NUMBER}") for p in PAGES)
check("wa.me placeholder fully replaced", ph == 0, f"found {ph} leftover placeholder link(s)")
check("wa.me links present and consistent", wa == 3, f"expected 3 links to wa.me/{WA_NUMBER}, found {wa}")

# ---------- 6. A11y basics ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    ok = ('lang="en"' in html and 'name="viewport"' in html
          and html.count("<h1") == 1 and 'aria-label' in html)
    check(f"a11y basics (lang/viewport/single-h1/aria): {p.relative_to(ROOT)}", ok)
css = (ROOT/"public"/"styles.css").read_text(encoding="utf-8")
check("a11y: focus-visible style", ":focus-visible" in css)
check("a11y: reduced motion respected", "prefers-reduced-motion" in css)

# ---------- 7. CSS sanity ----------
check("css braces balanced", css.count("{") == css.count("}"),
      f'{css.count("{")} open vs {css.count("}")} close')
for var in ["--dusk","--marigold","--day","--disp","--body","--dev"]:
    check(f"css token defined: {var}", var+":" in css)

# ---------- 8. JS syntax (node --check on extracted scripts) ----------
for p in PAGES:
    for i, js in enumerate(re.findall(r"<script>(.*?)</script>", p.read_text(encoding="utf-8"), re.S)):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(js); tmp = f.name
        r = subprocess.run(["node","--check",tmp], capture_output=True, text=True)
        check(f"js syntax: {p.relative_to(ROOT)} script#{i}", r.returncode == 0, r.stderr.strip()[:120])

# ---------- 9. Shared stylesheet + fonts wired ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    check(f"styles.css linked: {p.relative_to(ROOT)}", "styles.css" in html)
    check(f"fonts wired: {p.relative_to(ROOT)}", "fonts.googleapis.com" in html and "Fraunces" in html)


# ---------- 10. SECURITY ----------
import json as _json
REPO = ROOT.parent.parent if (ROOT.parent.parent / "vercel.json").exists() else ROOT.parent
API_DIR = REPO / "api"

# 10a. secret scan — no credentials anywhere in tracked source
SECRET_PATTERNS = [
    (r"sk-ant-[A-Za-z0-9\-_]{10,}", "anthropic key"),
    (r"sk-[A-Za-z0-9]{40,}", "api secret key"),
    (r"vcp_[A-Za-z0-9]{20,}", "vercel token"),
    (r"napi_[A-Za-z0-9]{20,}", "neon token"),
    (r"AKIA[0-9A-Z]{16}", "aws key"),
    (r"-----BEGIN( RSA| EC)? PRIVATE KEY-----", "private key"),
    (r"postgres(ql)?://[^\s\"']*:[^\s\"']*@", "db url with password"),
    (r"eyJhbGciOi[A-Za-z0-9_\-]{30,}", "jwt token"),
]
scan_files = [f for f in REPO.rglob("*")
              if f.is_file() and f.suffix in (".mjs", ".js", ".html", ".json", ".md", ".yml", ".sql", ".sh", ".py")
              and ".git" not in f.parts and "node_modules" not in f.parts]
for pat, label in SECRET_PATTERNS:
    hits = [str(f.relative_to(REPO)) for f in scan_files if re.search(pat, f.read_text(encoding="utf-8", errors="ignore"))]
    check(f"security: no {label} committed", not hits, ", ".join(hits[:3]))

# 10b. security headers enforced platform-wide
vj = _json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))
hdrs = {h["key"] for blk in vj.get("headers", []) for h in blk.get("headers", [])}
for need in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
    check(f"security header set: {need}", need in hdrs)

# 10c. every data endpoint proves circle membership before touching data
GUARDED = ["board", "book", "care", "chats", "circle", "events", "games", "plans", "push"]
for name in GUARDED:
    f = API_DIR / f"{name}.mjs"
    if not f.exists():
        check(f"membership guard present: api/{name}.mjs", False, "file missing"); continue
    src = f.read_text(encoding="utf-8")
    check(f"membership guard present: api/{name}.mjs",
          "Not a member of this circle" in src and "circleByCode" in src)

# 10d. SQL only ever through the tagged-template driver (parameterized)
for f in sorted(API_DIR.glob("*.mjs")):
    src = f.read_text(encoding="utf-8")
    check(f"security: no string-built sql in api/{f.name}",
          "sql(" not in src.replace("sql('','')", "") and ".query(" not in src)

# 10e. service worker never caches API responses; app JS avoids eval
sw = (REPO / "site/public/app/sw.js").read_text(encoding="utf-8")
check("security: service worker bypasses /api/", "/api/" in sw)
app_html = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("security: no eval in app", "eval(" not in app_html and "new Function(" not in app_html)

print()
if FAILS:
    print(f"{len(FAILS)} CHECK(S) FAILED"); sys.exit(1)
print("ALL SITE CHECKS PASS")
