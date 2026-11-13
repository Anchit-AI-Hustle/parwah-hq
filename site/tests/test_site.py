#!/usr/bin/env python3
"""Parwah site test suite - run after ANY change; all checks must pass before commit."""
import re, sys, subprocess, tempfile
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
# Discovered, not listed. This was four hardcoded paths, which meant /demo/
# was never structure-checked, link-checked, anchor-checked or claims-checked,
# and every page added after it inherited the same silence. A check that does
# not know about a page cannot fail on it.
PAGES = sorted((ROOT / "public").rglob("*.html"))
# The marketing pages are documents; the app (at the root, "/") and /demo/
# are applications. Two
# rules genuinely differ between them: a document has exactly one h1, an app
# has one per screen and shows one screen at a time (asserted in the browser
# suite, where visibility is knowable); and the shared stylesheet is the
# marketing design system, which the app deliberately does not use.
APP_PAGE = ROOT / "public" / "index.html"
SITE_PAGES = [p for p in PAGES
              if p != APP_PAGE and "demo" not in p.relative_to(ROOT / "public").parts]

def markup_only(html):
    """Drop script and style bodies. A href inside a JS template string is
    not a link a person can follow, and treating it as one produced four
    false dead links in the app on the first run of this scan."""
    return re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
FAILS = []

def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  - " + detail) if detail else ""))
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
    html = markup_only(p.read_text(encoding="utf-8")); bad = []
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith(("http","mailto:","#","tel:","data:")): continue
        if href.startswith("itms-services:"):
            # An iPhone install link: its manifest must be one of the site's own files.
            m = re.search(r"url=https://parwah-hq\.anchit-tandon\.com/([^&\"]+)", href)
            if not (m and (ROOT / "public" / m.group(1)).exists()): bad.append(href)
            continue
        # A query string selects a state of the page, not another file.
        # A path from the root ("/welcome/") is resolved from site/public,
        # the way the server does: the 404 page is served at any depth, so
        # its links must not depend on the folder it was asked for from.
        _path = href.split("#")[0].split("?")[0]
        target = ((ROOT / "public" / _path.lstrip("/")) if _path.startswith("/")
                  else (p.parent / _path)).resolve()
        if target.is_dir(): target = target / "index.html"
        if not target.exists(): bad.append(href)
    check(f"internal links: {p.relative_to(ROOT)}", not bad, ", ".join(bad))
# The 404 page is served for any missing address, one folder deep or five.
# A relative "styles.css" then points into a folder that does not exist, so
# the page arrived unstyled and its two links were 404s themselves.
_nf = (ROOT / "public" / "404.html").read_text(encoding="utf-8")
_nf_rel = [u for u in re.findall(r'(?:href|src)="([^"]+)"', _nf)
           if not u.startswith(("/", "http", "mailto:", "#", "tel:", "data:"))]
check("internal links: the 404 page names every path from the root", not _nf_rel, ", ".join(_nf_rel))

# ---------- 3. Anchor targets exist ----------
for p in PAGES:
    html = markup_only(p.read_text(encoding="utf-8"))
    ids = set(re.findall(r'id="([^"]+)"', html)); bad = []
    for href in re.findall(r'href="#([^"]+)"', html):
        if href not in ids: bad.append("#"+href)
    check(f"anchor targets: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

# ---------- 4. Banned therapeutic claims and dignity-first voice ----------
# Two rule sets merged when the D2C products brand folded into this repo.
# Each list had terms the other lacked: this one banned prevent, remedy and
# pain relief; that one banned arthritis, diabetes, elderly and burden. The
# last two are voice rules, not claims, and they are the ones that matter
# for copy about mobility and bathroom safety.
#
# Word boundaries, not substrings. The old list banned the substring "cure",
# so the first person to write "secure" would have turned the gate red for
# the wrong reason. It passed only because no scanned page said it.
BANNED = {
    # therapeutic claims
    "cure":                r"\bcure[sd]?\b",
    "treat":               r"\btreat(s|ed|ing|ment|ments)?\b",
    "heal":                r"\bheal(s|ed|ing)?\b",
    "therapy":             r"\btherap(y|ies|eutic|ist|ists)\b",
    "remedy":              r"\bremed(y|ies)\b",
    "medicinal":           r"\bmedicinal\b",
    "calling it medicine": r"\b(is|are|as)\s+(a\s+)?medicines?\b",
    "prevents":            r"\bprevent(s|ed|ing|ion)?\b",
    "reverses":            r"\breverse[sd]?\b",
    "clinically proven":   r"clinically\s+proven",
    "doctor recommended":  r"doctor[\s-]+recommended",
    "pain relief":         r"\bpain\s+relief\b",
    "guaranteed result":   r"\bguaranteed\s+results?\b",
    # named conditions: never ours to mention next to a product
    "arthritis":           r"\barthritis\b",
    "diabetes":            r"\bdiabet(es|ic)\b",
    # dignity-first voice: seniors have agency and are not a weight
    "elderly":             r"\belderly\b",
    "burden":              r"\bburden(s|ed|some)?\b",
}

def page_copy(path):
    """The words a person reads. Not the code, and not the legal disclaimer.

    Script and style bodies are stripped because a banned word inside a
    variable name is not a claim to anyone. The disclaimer is exempted by
    its element, <p class="legal">, rather than by matching its sentence:
    the old exemption was a 46-character string, so rewording the
    disclaimer would have silently switched the exemption off and turned
    the gate red on the very text that keeps us compliant.
    """
    h = path.read_text(encoding="utf-8")
    h = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", h, flags=re.S | re.I)
    h = re.sub(r'<([a-z]+)[^>]*class="[^"]*\blegal\b[^"]*"[^>]*>.*?</\1>',
               " ", h, flags=re.S | re.I)
    return re.sub(r"<[^>]+>", " ", h).lower()

# Every page, discovered rather than listed. The old scan named four files,
# so /demo/ was never checked at all and any page added later would have
# escaped silently. merge/ is included because that copy is queued to move
# into the site and must clear the bar before it does.
_repo_root = ROOT.parent
CLAIM_PAGES = sorted(list((ROOT / "public").rglob("*.html"))
                     + list((_repo_root / "merge").rglob("*.html")))
# Six live pages plus whatever is staged. If this ever drops to the four
# that used to be hardcoded, the discovery has broken and the scan is
# quietly covering less than it claims to.
check("claims: the scan finds the pages instead of being told them",
      len(CLAIM_PAGES) >= 6, f"{len(CLAIM_PAGES)} pages scanned")
for p in CLAIM_PAGES:
    text = page_copy(p)
    hits = sorted({label for label, pat in BANNED.items() if re.search(pat, text)})
    check(f"zero-claims scan: {p.relative_to(_repo_root)}", not hits, ", ".join(hits))

# CLAUDE.md summarises these rules for whoever writes the next page, and a
# summary that disagrees with the gate is worse than no summary: it tells
# someone a word is safe when the build will reject it. The list here is the
# authority; the document must name every term in it.
#
# CLAUDE.md is kept out of every Vercel upload by .vercelignore, on purpose,
# and this line once read it unconditionally: every production build died on
# FileNotFoundError before a single page was checked. So it is skipped only
# where its absence is by design - Vercel's builder - and a CI run that
# cannot find it still fails, because that would mean the checkout is wrong.
import os as _os
_claude_path = _repo_root / "CLAUDE.md"
if _claude_path.exists():
    _claude_md = _claude_path.read_text(encoding="utf-8").lower()
    _undocumented = [k for k in BANNED if k not in _claude_md]
    check("claims: every banned term is written down where authors will read it",
          not _undocumented, ", ".join(_undocumented))
elif _os.environ.get("GITHUB_ACTIONS") == "true":
    check("claims: CLAUDE.md is in the CI checkout, so the ban list can be compared",
          False, "missing from a full checkout")
else:
    print("SKIP  claims: CLAUDE.md is not in this build input (.vercelignore keeps it out) - compared in CI instead")

# ---------- 5. WhatsApp number guard (real number live; placeholder must never return) ----------
WA_NUMBER = "919873945238"
ph = sum(p.read_text(encoding="utf-8").count("91XXXXXXXXXX") for p in PAGES)
wa = sum(p.read_text(encoding="utf-8").count(f"wa.me/{WA_NUMBER}") for p in PAGES)
check("wa.me placeholder fully replaced", ph == 0, f"found {ph} leftover placeholder link(s)")
# Not a fixed count any more: pages get added, and a check that has to be
# edited every time one is added gets edited without being thought about.
# What must hold is that every wa.me link on the site is THIS number.
_wa_all = sum(len(re.findall(r"wa\.me/(\d+)", p.read_text(encoding="utf-8"))) for p in PAGES)
_wa_wrong = sorted({n for p in PAGES
                    for n in re.findall(r"wa\.me/(\d+)", p.read_text(encoding="utf-8"))
                    if n != WA_NUMBER})
check("wa.me links present", wa >= 3, f"found {wa} links to wa.me/{WA_NUMBER}")
check("wa.me links all go to the real number, none to another",
      not _wa_wrong and _wa_all == wa, ", ".join(_wa_wrong))

# No public page promises an offer the launch no longer makes.
_promises = [str(q.relative_to(ROOT / "public")) for q in SITE_PAGES
             if re.search(r"founding[- ]member|launch-week pricing", markup_only(q.read_text(encoding="utf-8")), re.I)]
check("public pages: no founding-member or launch-week pricing is promised", not _promises, ", ".join(_promises))

# ---------- 6. A11y basics ----------
for p in PAGES:
    html = p.read_text(encoding="utf-8")
    missing = [n for n, present in (
        ("lang", 'lang="en"' in html),
        ("viewport", 'name="viewport"' in html),
        ("aria-label", 'aria-label' in html),
    ) if not present]
    check(f"a11y basics (lang/viewport/aria): {p.relative_to(ROOT)}",
          not missing, ", ".join(missing))
for p in SITE_PAGES:
    n = p.read_text(encoding="utf-8").count("<h1")
    check(f"a11y: exactly one h1: {p.relative_to(ROOT)}", n == 1, f"found {n}")
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
for p in SITE_PAGES:
    html = p.read_text(encoding="utf-8")
    check(f"styles.css linked: {p.relative_to(ROOT)}", "styles.css" in html)
    check(f"fonts wired: {p.relative_to(ROOT)}", "fonts.googleapis.com" in html and "Bricolage+Grotesque" in html)


# ---------- 10. SECURITY ----------
import json as _json
REPO = ROOT.parent.parent if (ROOT.parent.parent / "vercel.json").exists() else ROOT.parent
API_DIR = REPO / "api"

# 10a. secret scan - no credentials anywhere in tracked source
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

# NO EM DASHES. A standing instruction on this project, and it was being
# broken 900 times over, including 22 in the copy on the home page and 319
# in the app. The scan above missed them because a grep -P lookbehind failed
# silently, which is the whole reason this is a check and not a habit.
# .claude/skills/ is vendored third-party documentation, not ours to rewrite;
# public/ is the build's copy of site/public and is checked at its source.
_dash_files = [f for f in REPO.rglob("*")
               if f.is_file()
               and f.suffix in (".mjs", ".js", ".html", ".json", ".md", ".yml",
                                ".sql", ".sh", ".py", ".css", ".txt",
                                ".webmanifest")
               and ".git" not in f.parts and "node_modules" not in f.parts
               and "skills" not in f.parts and f.parts[len(REPO.parts):][:1] != ("public",)]
# An em dash also travels encoded, and the encoded ones are the dangerous
# kind because they read as noise in the source and as an em dash to the
# person. One sat percent-encoded inside the WhatsApp click-to-chat link on
# three pages, so every visitor who tapped it got an em dash typed into
# their own message. The patterns are built from pieces so this file does
# not match itself.
EM_FORMS = [
    ("\u2014",            "em dash"),
    ("%E2%80" + "%94",    "percent-encoded em dash"),
    ("&md" + "ash;",      "mdash entity"),
    ("&#82" + "12;",      "decimal entity"),
    ("&#x20" + "14;",     "hex entity"),
]
# En dashes: none in what a person sees - the site, and every message the
# server sends back. Copy uses a hyphen, or words ("2 to 12 players").
EN_FORMS = [
    ("\u2013",            "en dash"),
    ("%E2%80" + "%93",    "percent-encoded en dash"),
    ("&nd" + "ash;",      "ndash entity"),
    ("&#82" + "11;",      "decimal en dash entity"),
    # Escaped in script: invisible in the source, a dash on the screen.
    ("\\u20" + "14",      "escaped em dash in script"),
    ("\\u20" + "13",      "escaped en dash in script"),
]
_user_facing = lambda f: f.parts[len(REPO.parts):][:2] == ("site", "public") or f.parts[len(REPO.parts):][:1] == ("api",)
_dashed = []
for f in _dash_files:
    body = f.read_text(encoding="utf-8", errors="ignore")
    for needle, label in EM_FORMS + (EN_FORMS if _user_facing(f) else []):
        n = body.lower().count(needle.lower())
        if n:
            _dashed.append(f"{f.relative_to(REPO)}: {n} {label}")
check("copy: no em dashes anywhere, and no en dashes in anything a person sees",
      not _dashed, "; ".join(_dashed[:4]))

# PUSHES DO NOT DEPLOY. Vercel's Hobby plan refuses to build a private
# organisation repository from Git, so every push to every branch posted a
# red "Cannot deploy" check next to the real ones. Production and previews
# are deployed on purpose instead (the deploy workflow, or directly), from a
# commit that has passed the gate here and on Vercel's own builder.
check("deploy: a push never triggers a Vercel deployment by itself",
      _json.loads((REPO / "vercel.json").read_text(encoding="utf-8")).get("git", {}).get("deploymentEnabled") is False)

# 10b. security headers enforced platform-wide
vj = _json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))
hdrs = {h["key"] for blk in vj.get("headers", []) for h in blk.get("headers", [])}
for need in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
    check(f"security header set: {need}", need in hdrs)

# THE APP LIVES AT THE ROOT. parwah-hq.anchit-tandon.com IS the app - not a
# redirect to it - so the address a family sees and shares is the domain
# itself, and /#day, /#vault, /?join=CODE are the app's own routes.
_pub = REPO / "site/public"
_apph = (_pub / "index.html").read_text(encoding="utf-8")
check("routing: the root page is the app",
      "postMessage({ parwah: 'ready' }" in _apph and 'id="au-why"' in _apph)
check("routing: served as it is, not redirected or rewritten",
      not any(r.get("source") == "/" for r in vj.get("redirects", []) + vj.get("rewrites", [])))
check("routing: the old home page moved to /welcome/, not deleted",
      (_pub / "welcome/index.html").exists())
_man = _json.loads((_pub / "manifest.webmanifest").read_text(encoding="utf-8"))
check("routing: the installed app opens at, and covers, the whole domain",
      _man.get("start_url") == "/" and _man.get("scope") == "/")
# The id is the installed app's identity. Changing it would make every phone
# that installed Parwah see a second, different app instead of an update.
check("routing: and keeps its identity, so installs update rather than duplicate",
      _man.get("id") == "/app/")
_sw = (_pub / "sw.js").read_text(encoding="utf-8")
check("routing: the offline worker lives at the root and caches the root",
      "'/'" in _sw and "/app/" not in _sw)
# Old links, old installs and the Floot shell's first build all say /app/.
# Browsers carry the #route through a redirect, so /app/#day lands on /#day.
_old = {r.get("source"): r for r in vj.get("redirects", [])}
check("routing: the old address still works, and lands on the root",
      all(_old.get(src, {}).get("destination") == "/" for src in ("/app", "/app/", "/app/index.html")))
check("routing: the app's old file addresses follow it",
      _old.get("/app/:file(manifest\\.webmanifest|icon-192\\.png|icon-512\\.png|icon-512-maskable\\.png|apple-touch-icon\\.png|mark\\.svg)", {}).get("destination") == "/:file")
# Temporary, because browsers cache a permanent redirect for a very long time.
check("routing: none of those redirects is permanent, so they can be undone",
      all(r.get("permanent") is False for r in vj.get("redirects", [])))
# Another domain the family may type (parwah.tech, parwah.in) forwards
# everything to the one live site. Those catch-alls are tied to their own
# host, so they can never catch this site's API.
_hostfwd = [r for r in vj.get("redirects", []) if any(h.get("type") == "host" for h in r.get("has", []))]
check("routing: no redirect can catch the API",
      not any("api" in r.get("source", "") or r.get("source") in ("/(.*)", "/:path*")
              for r in vj.get("redirects", []) if r not in _hostfwd))
check("routing: other Parwah domains forward to the live site, and only there",
      {h["value"] for r in _hostfwd for h in r["has"]} == {"parwah.tech", "parwah.in", "www.parwah.in"}
      and all(r.get("destination") == "https://parwah-hq.anchit-tandon.com/$1" for r in _hostfwd)
      and not any(h["value"] == "parwah-hq.anchit-tandon.com" for r in _hostfwd for h in r["has"]))
# A service worker script cannot be redirected: the browser refuses it. The
# old /app/sw.js has to stay a real file, and what it does is remove itself.
_oldsw = (_pub / "app/sw.js")
check("routing: the old /app/ worker is a real file that is never redirected",
      _oldsw.exists() and not any("sw" in src for src in _old))
_oldsw_s = _oldsw.read_text(encoding="utf-8") if _oldsw.exists() else ""
_oldsw_code = "\n".join(l for l in _oldsw_s.splitlines() if not l.strip().startswith("//"))
check("routing: and all it does is unregister itself, deleting nothing shared",
      "registration.unregister()" in _oldsw_code
      and not any(w in _oldsw_code for w in ("caches", "fetch", "importScripts")))
_stale = []
for _p in PAGES:
    for _h in re.findall(r'href="([^"]*)"', markup_only(_p.read_text(encoding="utf-8"))):
        if re.search(r"(^|/)app/", _h): _stale.append(f"{_p.relative_to(ROOT)}: {_h}")
check("routing: no page links to the old /app/ address", not _stale, "; ".join(_stale[:4]))
check("routing: invite links share the root of wherever Parwah is open, not /app/",
      "location.origin + '/?join='" in _apph and "/app/?join=" not in _apph)
check("routing: a reminder tapped on the phone opens the root",
      "payload.url || '/'" in (REPO / "api/_push.mjs").read_text(encoding="utf-8"))

# THE PHONE APPS FRAME THE APP. The iPhone and Android apps are a Floot shell
# that shows the app in a frame. Every other page still refuses to be framed
# (clickjacking), and the app allows exactly the shell's origins - never a
# wildcard, because any site allowed to frame the app could overlay it.
_hblocks = {b.get("source"): {h["key"]: h["value"] for h in b.get("headers", [])}
            for b in vj.get("headers", [])}
_rest = _hblocks.get("/(.+)", {})
_app = _hblocks.get("/", {})
check("framing: every page but the app still refuses to be framed",
      _rest.get("X-Frame-Options") == "SAMEORIGIN" and "/(.*)" not in _hblocks
      and "X-Frame-Options" not in _app, ", ".join(_hblocks))
check("framing: the app keeps the other security headers",
      _app.get("X-Content-Type-Options") == "nosniff" and "Referrer-Policy" in _app)
_fa = re.fullmatch(r"frame-ancestors ((?:\S+ ?)+)", _app.get("Content-Security-Policy", ""))
_fa_list = _fa.group(1).split() if _fa else []
# The Floot origins were dropped (owner, 2026-10-30): the Capacitor apps in
# mobile/ replace the Floot shell, and a hosted builder's domains framing the
# live app were one more place an overlay could come from. The old Floot
# shell no longer shows the app.
_FA_ALLOWED = {"'self'", "capacitor://localhost", "https://localhost"}
check("framing: the app may be framed only by the Parwah shell",
      bool(_fa_list) and set(_fa_list) <= _FA_ALLOWED and "capacitor://localhost" in _fa_list,
      " ".join(_fa_list))
check("framing: the app asks only for the camera, microphone and location it uses",
      _app.get("Permissions-Policy") == _rest.get("Permissions-Policy")
      == "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()")
check("framing: a content policy is reported on, not yet enforced",
      "Content-Security-Policy-Report-Only" in _app and "Content-Security-Policy-Report-Only" in _rest
      and "object-src 'none'" in _app.get("Content-Security-Policy-Report-Only", ""))
check("framing: and never by a wildcard",
      not any("*" in o or o in ("https:", "http:", "data:", "blob:") for o in _fa_list))
# The shell waits for this before showing the app. It goes to any origin, so
# it must carry nothing about the family.
_ready = re.findall(r"postMessage\((.*?)\)", _apph)
check("framing: the app tells the shell it started, and nothing more",
      _ready == ["{ parwah: 'ready' }, '*'"], "; ".join(_ready))

# 10c. every data endpoint proves circle membership before touching data
# every module that touches circle data must prove membership first
GUARDED = ["_boardapi", "_keysapi", "_pushapi", "_vaultapi", "book", "care", "chats", "circle", "events", "games", "plans"]
for name in GUARDED:
    f = API_DIR / f"{name}.mjs"
    if not f.exists():
        check(f"membership guard present: api/{name}.mjs", False, "file missing"); continue
    src = f.read_text(encoding="utf-8")
    check(f"membership guard present: api/{name}.mjs",
          ("requireMember(" in src or "ownedMember(" in src) and "tokenOf(req)" in src)

# 10d. SQL only ever through the tagged-template driver (parameterized)
for f in sorted(API_DIR.glob("*.mjs")):
    src = f.read_text(encoding="utf-8")
    check(f"security: no string-built sql in api/{f.name}",
          "sql(" not in src.replace("sql('','')", "") and ".query(" not in src)

# 10e. service worker never caches API responses; app JS avoids eval
sw = (REPO / "site/public/sw.js").read_text(encoding="utf-8")
check("security: service worker bypasses /api/", "/api/" in sw)
app_html = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("security: no eval in app", "eval(" not in app_html and "new Function(" not in app_html)

# 10f. THE VAULT - the promises made to the family are checked here, not
# trusted to the interface. A change that breaks one of these cannot deploy.
vault = (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8")
check("vault: a full identity number is never stored",
      "last4" in vault and not re.search(r"(number|aadhaar|pan)\s*(text|=\s*clean\()", vault),
      "only the last four digits may be persisted")
# The ID rules moved to _docid.mjs so the FIELD can apply them as the family
# types, instead of the server refusing at save time. Both still check.
docid = (API_DIR / "_docid.mjs").read_text(encoding="utf-8")
check("vault: Aadhaar numbers are checksum-verified",
      "verhoeffOk" in docid and "V_D" in docid and "checkNumber" in vault)
check("vault: the server still has the last word on a number",
      "const chk = checkNumber(kind, body.number, aRow[0].country);" in vault
      and "return res.status(400).json({ ok: false, error: chk.why });" in vault)
# The only free, legitimate PAN signals: the 4th and 5th characters, both
# published by the Income Tax Department. The 10th is a check digit whose
# algorithm has never been published - so we must not pretend to check it.
check("vault: a PAN is read for what it actually encodes",
      "PAN_HOLDER" in docid and "panFacts" in docid
      and "an individual" in docid and "a company" in docid)
check("vault: and never claims to verify the undisclosed check digit",
      "has never published" in docid and "does NOT pretend" in docid)
_appv = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("vault: a surname mismatch is a note, never a refusal",
      "Worth a look" in _appv and "not every name puts the surname last" in _appv
      and "vPanNote" in _appv)
check("vault: card credentials are refused outright",
      "credentialRisk" in vault and "cvv" in vault.lower() and "never stores a full card number" in vault)
check("vault: a document is invisible without a grant",
      "a.member_id is not null" in vault and "not shared with you" in vault)
check("vault: only the owner decides who sees their papers",
      "Only the person this document belongs to can decide who sees it" in vault)
check("vault: opening a document is logged and the owner is told",
      "'opened'" in vault and "every open is recorded" in vault)
check("vault: you cannot verify a document you uploaded yourself",
      "someone else in the family needs to check it" in vault)
check("vault: only the owner re-permissions their payment method",
      "ownedMethod" in vault and "owner_member !== me.id" in vault)
check("vault: uploads are size- and type-limited",
      "MAX_FILE" in vault and "OK_MIME" in vault)
app_src = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("vault: the app never renders more than a masked number",
      "'Ending ' + d.last4" in app_src and "'••••' + esc(d.last4)" in app_src)

# 10g. WAY IN - a short invite code must not be the whole security model.
dbsrc = (API_DIR / "_db.mjs").read_text(encoding="utf-8")
circ = (API_DIR / "circle.mjs").read_text(encoding="utf-8")
auth = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
check("join: approval is the default for every circle",
      "join_policy text not null default 'approve'" in dbsrc)
check("join: a code alone creates a request, not a membership",
      "insert into join_requests" in circ and "pending: true" in circ)
check("join: any member can decide, there is no owner",
      "approve_join" in circ and "decline_join" in circ and "Not a member of this family" in circ)
check("rate limit: join attempts are capped", "rateLimit(sql, 'join'" in circ)
check("rate limit: sign-in attempts are capped", "rateLimit(sql, 'auth'" in auth)
check("rate limit: counted in the database, not per instance",
      "create table if not exists rate_limit" in dbsrc and "make_interval" in dbsrc)
check("rate limit: a broken limiter never locks the family out",
      "catch (e) { return !failClosed; }" in dbsrc and "failClosed = false" in dbsrc)
# Only the timer fails closed; an SOS alert never waits on a broken limiter.
check("rate limit: the timer fails closed, SOS alerts do not",
      "rateLimit(sql, 'tick', 'all', 1, 50, { failClosed: true })" in (API_DIR / "events.mjs").read_text(encoding="utf-8")
      and "rateLimit(sql, 'sos', me.id, 3, 600))" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))

# 10h. COINS - the credit that pays for Ekta.
coins = (API_DIR / "_coins.mjs").read_text(encoding="utf-8")
ekta = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("coins: the balance is the ledger, never a stored number",
      "sum(delta)" in coins and "balance integer" not in coins)
check("coins: earning pays once, enforced by an index",
      "coins_once" in coins and "on conflict do nothing" in coins)
check("coins: awarding can never break the action that earned it",
      "catch (e) { return 0; }" in coins)
check("coins: Ekta is paid for out of the family pot",
      "spend(sql, circle.id, me.id, 'ekta')" in ekta and "needCoins" in ekta)
check("coins: an unanswered turn is refunded", "'refund'" in ekta)
check("coins: an empty pot refuses rather than going negative",
      "if (have < cost) return { ok: false" in coins)

# 10i. MULTI-CIRCLE - a person in several families must see which needs them.
check("circles: each carries what is waiting in it",
      all(k in auth for k in ('"unread"', '"waiting"', '"openRequests"', '"live"')))
check("circles: your own messages never count as unread",
      "ms.member_id is distinct from m.id" in auth)
check("circles: unread respects private chats you are not in",
      "ch.kind = 'circle' or cm.member_id is not null" in auth)
appsrc = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("circles: the sign-in list leads with the circle that needs you",
      "circleSignals" in appsrc and "needsyou" in appsrc)

# 10j. MEMORY CONSENT - a fact about a person is that person's to share.
book = (API_DIR / "book.mjs").read_text(encoding="utf-8")
# The table itself is made in _bookschema.mjs, shared with the care tools.
_bookschema = (API_DIR / "_bookschema.mjs").read_text(encoding="utf-8")
check("memory: entries can be private to their subject",
      "visibility text not null default 'circle'" in _bookschema and "book_access" in _bookschema and "ensureBookSchema(sql)" in book)
check("memory: consent belongs to the person it is about, not the author",
      "Only the person this is about can decide who sees it" in book and "subjectOf" in book)
check("memory: a private entry cannot be read, edited or removed without a grant",
      book.count("readable(") >= 4 and "That is not shared with you" in book)
check("memory: every consent change is written to a ledger", "book_consent" in book)
check("memory: preparedness counts private entries without exposing them",
      "const mine = all.filter" in book and "can_see" in book)

# 10k. ONBOARDING - a first-ever sign-in must explain the app, and everyone
# must be able to start a family or a group.
check("onboarding: the introduction is recorded per person, not per device",
      "toured_at" in dbsrc and "action === 'toured'" in auth and "toured: !!user.toured_at" in auth)
check("onboarding: a circle is a family or a group",
      "kind text not null default 'family'" in dbsrc and "kind === 'group' ? 'group' : 'family'" in circ)
check("onboarding: a first-ever sign-in is shown what the app is",
      "TOUR = [" in appsrc and "if (toured === false) { showTour(); return; }" in appsrc)
check("onboarding: the interface is pointed at once, then never again",
      "startCoach" in appsrc and "action:'toured'" in appsrc)
check("onboarding: starting a family or a group is offered everywhere",
      all(k in appsrc for k in ("cs-newfam", "cs-newgrp", "side-newcircle", "d-newcircle", "pickkind")))

# 10l. LAYOUT - sidebar-only controls must never reach the mobile tab bar.
check("layout: .side-only is specific enough to beat .tabs button",
      ".tabs .side-only{display:none}" in appsrc and ".tabs .side-only{display:flex}" in appsrc)
check("layout: the desktop content is not capped at a phone width",
      "body.inapp .wrap{max-width:1560px" in appsrc)
# Memory and the Vault are "a list, and a form to add to it". On a wide window
# that was one narrow ribbon with the form scrolled off. The grid spans below
# must match how many children each list view actually puts in column one -
# add a filter row and forget the span, and the form detaches from the list.
_lv = {"book-list-view": 4, "vd-list-view": 4}
_spans = []
for cid, want in _lv.items():
    m = re.search(r'<div id="%s">' % cid, appsrc)
    depth, i, kids = 1, m.end(), 0
    for t in re.finditer(r'<(/?)(div|select|details)\b[^>]*>', appsrc[i:]):
        closing, name = t.group(1), t.group(2)
        if name == "select":
            if depth == 1 and not closing: kids += 1
            continue
        if closing:
            depth -= 1
            if depth == 0: break
        else:
            if depth == 1: kids += 1
            depth += 1
    left = kids - 1                       # the last child is the form itself
    css = "#%s>.card{grid-row:1/span %d}" % (cid, left)
    if left != want or css not in appsrc:
        _spans.append("%s: %d in the left column, css says %s" % (cid, left, want))
check("layout: the add-form rail spans the whole list beside it",
      not _spans, "; ".join(_spans))
check("layout: a list that owns a column is allowed to use it",
      "#pane-memory .feed,#pane-vault .feed,.subsec .feed{max-width:none}" in appsrc
      and "@media(min-width:1180px)" in appsrc)
# The sidebar is taller than many laptop screens. Everything below "Together"
# used to be clipped with no way to reach it.
check("layout: the sidebar scrolls instead of clipping what does not fit",
      ".tabs .inner{flex-direction:column" in appsrc and "overflow-y:auto" in appsrc
      and "was simply clipped and unreachable" in appsrc)
check("layout: the brand and the account line stay put while it scrolls",
      ".side-brand{position:sticky" in appsrc and ".side-user{position:sticky" in appsrc)
check("layout: Today uses two columns on a wide screen",
      "homerail" in appsrc and "homemain" in appsrc and "@media(min-width:1240px)" in appsrc)

# 10m. THINGS TO DO, SOS ESCALATION, PRICING.
care = (API_DIR / "care.mjs").read_text(encoding="utf-8")
events = (API_DIR / "events.mjs").read_text(encoding="utf-8")
plan = (API_DIR / "_planapi.mjs").read_text(encoding="utf-8")
check("games: Ludo, Get Away and Monopoly are real games, not Coming soon tiles",
      all('data-bstart="' + k + '"' in appsrc for k in ("ludo", "bhabhi", "vyapar"))
      and "More coming" not in appsrc and "<small>Coming soon</small>" not in appsrc)
_bg = (API_DIR / "_boardgames.mjs").read_text(encoding="utf-8")
_gm = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("games: a board move saves only on the version it was made on (two taps never both land)",
      "coalesce((state->>'v')::int, 0) = ${v0}" in _gm)
check("games: in Get Away each player is sent only their own hand",
      "bhabhiView(game.state, memberId)" in _gm and "v.hands = st.hands.map((h, i) => (i === me ? h : []))" in _bg)
_bare = [l.strip() for l in appsrc.splitlines()
         if "fetch(" in l and "authHeaders" not in l and "function apiGet" not in l
         and "fetch(API.push)" not in l and "fetch('/', { method: 'HEAD'" not in l and not l.strip().startswith("//")]
check("auth: every API call carries the sign-in token (apiGet/post; only the public push key, and the page's own version, are fetched bare)",
      not _bare, "; ".join(_bare[:3]))
check("todo: reminders and tasks are one list, in three parts: Needs attention, Today, Coming up",
      all(k in appsrc for k in ("'g-need', 'Needs attention'", "'g-today', 'Today'", "'g-soon', 'Coming up'"))
      and "(data.reminders || []).forEach" in appsrc and "taskCache.forEach" in appsrc)
check("todo: one form makes a task; who does it decides open, given, or mine",
      "action:'task_create'" in appsrc and "ownerId: who === 'any' ? undefined : (who || 'me')" in appsrc)
tasks_src = (API_DIR / "_tasks.mjs").read_text(encoding="utf-8")
check("todo: a late task is announced once per occurrence (the update is the lock)",
      "overdue_alerted_for is distinct from due_at" in tasks_src and "set overdue_alerted_for = due_at" in tasks_src)
check("todo: a repeating task makes one next time, never two",
      "requests_series_due on requests (series_id, due_at)" in tasks_src and "on conflict do nothing" in tasks_src)
check("todo: taking and finishing are conditional updates, not read-then-write",
      "where id = ${t.id} and status = ${t.status}" in tasks_src
      and "where id = ${t.id} and status in ('open','assigned','claimed') returning id" in tasks_src)
check("todo: suggestions come from what the family already recorded",
      "careSuggestions" in care and "vault_docs" in care and "family_book" in care)
check("todo: a suggestion is never created behind the family's back",
      "data-sadd" in appsrc and "Nothing here is real until you add it" in appsrc)
check("todo: nothing already being done is suggested again",
      "busy.has(s.title.toLowerCase())" in care)
check("sos: an SOS is an open state, not a feed line",
      "create table if not exists sos" in events and "sos_ack" in events and "sos_resolve" in events)
check("sos: escalation fires exactly once across instances",
      "escalated = true" in events and "and escalated = false returning id" in events)
check("sos: escalation never breaks a read",
      "escalation must never break a read" in events)
check("pricing: dual currency at a fixed, stated rate",
      "USD_RATE = 85" in plan and "priceOf" in plan)
check("pricing: no payment rails, and the page says so",
      "charged: false" in plan and "Nothing is charged" in appsrc)
check("pricing: Indian digit grouping is not hand-rolled",
      "Intl.NumberFormat('en-IN')" in appsrc)

# 10n. THE GATE MUST RUN ON A FRESH CLONE.
# It failed on a real machine because the phone unit test imported _db.mjs,
# which imports the database driver - absent before npm install.
phonesrc = (REPO / "site/tests/phonetest.mjs").read_text(encoding="utf-8")
phonemod = (API_DIR / "_phone.mjs").read_text(encoding="utf-8")
check("gate: the phone unit test does not need the database driver",
      "_phone.mjs" in phonesrc and "_db.mjs" not in phonesrc)
# The one import allowed is the country table, which is plain data with no
# imports of its own, so the test still runs on a fresh clone.
_phone_imports = re.findall(r"^\s*import\s.*?from\s+'([^']+)'", phonemod, re.M)
_countries_src = (API_DIR / "_countries.mjs").read_text(encoding="utf-8")
# The app carries its own copy of the country table (dialling code, flag,
# ambulance) and of the currency table; a copy that drifts sends an SOS to
# the wrong number or a cap in the wrong money.
_idx_src = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
def _rows(src, start, end):
    i = src.find(start); j = src.find(end, i)
    return re.findall(r"\['([A-Z]{2})',\s*'([^']+)',\s*'(\+\d+)',\s*'(\d+)'\]", src[i:j + len(end)]) if i >= 0 and j > i else []
_api_rows = _rows(_countries_src, "export const COUNTRIES", "\n];")
_app_rows = _rows(_idx_src, "var COUNTRIES", "]];")
check("global: the app's country table is exactly the server's (code, name, dialling code, ambulance)",
      len(_api_rows) > 190 and _api_rows == _app_rows, f"{len(_api_rows)} vs {len(_app_rows)}")
_money_src = (API_DIR / "_money.mjs").read_text(encoding="utf-8")
def _cur(src, start):
    i = src.find(start); j = src.find("}", i)
    return dict(re.findall(r"([A-Z]{2}): '([A-Z]{3})'", src[i:j])) if i >= 0 else {}
_m_euro = re.search(r"const EURO = (\[[^\]]*\])", _money_src)
check("global: the app's currency table is exactly the server's",
      len(_cur(_money_src, "export const CURRENCY")) > 50
      and _cur(_money_src, "export const CURRENCY") == _cur(_idx_src, "var CURRENCY")
      and _m_euro and _m_euro.group(1) in _idx_src)
check("global: money and places modules import nothing, so they are tested before npm install",
      not re.search(r"^\s*import\s", _money_src, re.M)
      and not re.search(r"^\s*import\s", (API_DIR / "_places.mjs").read_text(encoding="utf-8"), re.M))
check("global: no made-up UPI ID - a bill link pays the biller's own ID or is not offered",
      "bills@parwah" not in (API_DIR / "_careprep.mjs").read_text(encoding="utf-8") and "'bill@upi'" not in _idx_src)
check("global: the privacy screen does not claim a data region Parwah does not use",
      "Mumbai AWS" not in _idx_src and "Mumbai Region" not in _idx_src)
check("gate: the phone rules module imports nothing but the plain country table",
      set(_phone_imports) <= {"./_countries.mjs"} and len(re.findall(r"^\s*import\s", phonemod, re.M)) == len(_phone_imports)
      and not re.search(r"^\s*import\s", _countries_src, re.M), str(_phone_imports))
check("gate: _db still re-exports the phone helpers for everything else",
      "export { PHONE_CC, normPhone, phoneError } from './_phone.mjs'" in dbsrc)
deploysh = (REPO / "ops/deploy.sh").read_text(encoding="utf-8")
check("deploy: dependencies are installed before the gate runs",
      "npm install" in deploysh and "node_modules" in deploysh)
check("deploy: a gate failure shows its output instead of hiding it",
      "tail -40" in deploysh and "Full output" in deploysh)
check("deploy: every vercel step shows its output on failure",
      "run_vercel()" in deploysh and ">/dev/null 2>&1" not in deploysh.split("run_vercel()")[1])
# The anti-pattern is `local rc=$?` as a STATEMENT; the comment explaining it
# mentions the same text, so match code lines only.
_codelines = [l.strip() for l in deploysh.splitlines() if not l.strip().startswith("#")]
check("deploy: the exit status captured is the command's, not local's",
      not any(re.match(r"^local\s+\w+=\$\?", l) for l in _codelines))
check("deploy: a failure names its own kind instead of blaming the token",
      "vercel_hint()" in deploysh and "could not reach api.vercel.com" in deploysh)
check("deploy: a fresh clone gets its project link written",
      ".vercel/project.json" in deploysh and "mkdir -p .vercel" in deploysh)
vign = (REPO / ".vercelignore").read_text(encoding="utf-8")
check("deploy: the private hq/ directory can never be uploaded",
      "hq/" in vign and ".claude/" in vign and "CLAUDE.md" in vign)
check("deploy: local artefacts stay out of the upload",
      "node_modules/" in vign and ".git/" in vign)
# Match CODE lines only - the comment explaining why pull and build were
# dropped necessarily names them, and tripped the first version of this.
_dcode = "\n".join(l for l in deploysh.splitlines() if not l.strip().startswith("#"))
check("deploy: source is deployed and built by Vercel, not pushed prebuilt",
      "deploy --prod --yes" in _dcode and "--prebuilt" not in _dcode
      and "vercel pull" not in _dcode and "vercel build" not in _dcode)
# A token in a shell profile goes stale long before anyone notices. Falling
# back to the login this machine already has is the difference between a
# deploy and a support round trip.
check("deploy: a stale token falls back to the login on this machine",
      "AUTH_MODE=login" in deploysh and "falling back to the login" in deploysh
      and 'AUTH_MODE=token' in deploysh)
check("deploy: no token at all is not a failure when someone is signed in",
      'if [ -n "${VERCEL_TOKEN:-}" ]; then' in deploysh
      and "no VERCEL_TOKEN" not in deploysh)
check("deploy: credentials are chosen once, not repeated at every call",
      "vc deploy --prod" in _dcode and "vc whoami" in _dcode
      and _dcode.count("--token=") == 1)
# macOS still ships bash 3.2, where an empty array under `set -u` is an
# unbound variable - which is why the credential is a string, not an array.
check("deploy: the credential switch works on bash 3.2",
      "AUTH_MODE" in deploysh and "=()" not in _dcode)
check("deploy: a gate failure reports the gate's exit code, not the if's",
      "RC=$?" in _dcode and "if ! bash scripts/checks.sh" not in _dcode)
check("deploy: it says the deploy is already live before it starts verifying",
      "ALREADY LIVE" in deploysh and "Ctrl-C" in deploysh)
check("deploy: verification is a script of its own, so the red path is testable",
      "ops/verify-live.sh" in deploysh)

# THE VERIFICATION, AND THE BUG IT WAS BUILT AROUND.
# A red self-test answers with HTTP 500 and puts the failing step in the body.
# The old poll fetched it with `curl -f`, which discards the body of any 4xx
# or 5xx - so a genuine failure arrived as an empty string, was read as "not
# serving yet", and after forty attempts died as "unreachable". The one thing
# a person needs, the name of the step, could not reach the log by construction.
verify = (REPO / "ops/verify-live.sh").read_text(encoding="utf-8")
_vcode = "\n".join(l for l in verify.splitlines() if not l.strip().startswith("#"))
check("verify: the verdict body is read, not thrown away with curl -f",
      "curl -sS -L" in _vcode and "curl -f" not in _vcode)
check("verify: a redirect is followed, so trailingSlash cannot look like a failure",
      " -L " in _vcode)
check("verify: the status code is captured alongside the body",
      "%{http_code}" in _vcode)
check("verify: a failure names the steps that failed",
      "failing_steps()" in _vcode and "grep -vx ok" in _vcode)
check("verify: an error carried in the body is printed too",
      '"error":"' in _vcode and "ERR=" in _vcode)
# These three used to be one message. "Answering but not green" is a database
# diagnosis, and it was being printed for an answer that never reached the
# database - which is how a morning went into the wrong file.
check("verify: no answer, a red self-test and some other reply are three cases",
      "VERDICT=silent" in _vcode and "VERDICT=red" in _vcode and "VERDICT=other" in _vcode)
check("verify: something that is not the self-test is named as that",
      "not the self-test" in verify)
check("verify: what actually came back is shown, not just its shape",
      "snippet()" in _vcode)
# A silent wait looks exactly like a hang. The first real deploy was killed
# with Ctrl-C during it - and the red self-test underneath went unseen.
check("verify: the wait says what it is waiting for",
      "attempt $i/$TRIES" in verify and "no answer yet" in verify)
check("verify: a red self-test is called in two minutes, not seven",
      "RED=$((RED + 1))" in _vcode and 'RED" -ge "$MAX_RED"' in _vcode)
check("verify: the day's arithmetic is checked on the build that went live",
      "probe=day" in verify and "muhurat self-test is RED" in verify)
check("verify: someone else's uptime never fails our deploy",
      "not fatal" in verify)
check("verify: it refuses to run against no url rather than passing quietly",
      "usage: ops/verify-live.sh" in verify and "exit 2" in verify)
check("verify: the red path is exercised by a test, not just described",
      (REPO / "site/tests/verifytest.mjs").exists()
      and "verifytest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("deploy: works on a machine without flock (macOS)",
      "command -v flock" in deploysh and 'mkdir "$LOCK.d"' in deploysh)

# 10o. THE PARENT VALIDATION GUIDE - the five concept screens it specifies.
pulse = (API_DIR / "_pulse.mjs").read_text(encoding="utf-8")
# This one passed for weeks against no database and failed the first time it
# met a real one - because it asserted a comparison instead of the counts, and
# never exercised the read cursor at all.
_st = (API_DIR / "_selftest.mjs").read_text(encoding="utf-8")
check("selftest: unread asserts exact counts, not a vague comparison",
      "papaUnread === 2 && betaUnread === 2" in _st and "betaUnread[0].n < papaUnread" not in _st)
check("selftest: reading a chat is what makes its messages stop counting",
      "papaAfterReading === 1" in _st and "insert into chat_reads" in _st)
check("selftest: a read cursor belongs to one person",
      "betaStillUnread === 2" in _st)
check("guide: one readiness number for the FAMILY, not six per-person bars",
      '"Your family is <span id="rd-pct">' in appsrc.replace("'", '"') or 'id="rd-pct"' in appsrc)
# The count asked for is the count listed under it: "Complete 3 important
# items" under four listed gaps did not add up.
check("guide: the number is backed by named gaps and a fill-in-these-N call to action that matches what is listed",
      "gapCount" in book and "rd-gaps" in appsrc and "'Fill in these ' + shown.length" in appsrc
      and "Math.min(3, f.gapCount)" not in appsrc)
check("guide: each gap is a plain sentence, the elders first, and the card waits while the first-run list shows",
      "no doctor recorded" in appsrc and "elder[b.memberId]" in appsrc and "!$('firstrun').hidden" in appsrc)
check("guide: someone near a person living away is a first-class contact",
      "'local'" in book and "someone near them to call" in book)
check("guide: the pulse question still rotates daily on the server (the app no longer asks it on Today)",
      "styleFor" in pulse and len(re.findall(r"^\s{2}\w+: \{ name:", pulse, re.M)) == 5)
check("guide: an answer can quietly say a call would be nice",
      "call: true" in pulse and "could do with a call" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))
check("guide: everyone in a circle sees the same question on the same day",
      "derived from the date" in pulse or "same style for everyone" in pulse)
# The paid plan lists what it ADDS, not a shorter copy of the free list,
# and never a feature that does not exist.
check("plan: the paid plan says what it adds, and never sells the removed mood question (Family Pulse)",
      "Parwah Family Plan" in plan and "'Everything in the free plan', 'Priority help', 'Supporting Parwah'" in plan
      and "'The vault - documents" in plan and "Pulse" not in plan)
check("plan: the reserved amount is kept to the cent, not rounded",
      "Math.round(price.amount)" not in plan and "numeric(10,2)" in plan)

# 10p. THE GUIDE'S REMAINING SCREENS - 1, 2 and 4.
ekta_src = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("guide screen 1: the home leads with the family and a short status line, then the five things",
      'id="hero-status"' in appsrc and 'id="w-fam"' in appsrc and 'id="w-health"' in appsrc)
check("guide screen 2: one person, in the sections the guide names, with what is due a re-check marked where it is",
      all(x in appsrc for x in (">🩺 Health<", ">📄 Documents<", ">📞 People to call<",
                                ">💡 Useful to know<", "due a re-check: nothing here is assumed current")))
check("guide screen 2: Records shows that a document exists, never the document",
      "has_file" in book and "d.about_member" in book and "encode(bytes" not in book)
check("guide screen 4: Ekta can prepare a summary for a doctor visit",
      "prepare_summary" in ekta_src and "someoneNearThem" in ekta_src)
check("guide screen 4: the summary reports what is MISSING, not only what is there",
      "missing" in ekta_src and "what is absent matters as much" in ekta_src)
check("guide screen 4: Ekta retrieves and organises, and never diagnoses",
      "not medical advice" in ekta_src and "ZERO medical advice" in ekta_src)

# 10q. WHO GETS TOLD.
# A notification about something involving two people must not reach the whole
# family. Every circle-wide push has to be one of a short, deliberate list.
CIRCLE_WIDE_OK = {
    # (file, fragment of the title) -> why the whole circle is right
    ("circle.mjs", "wants to join"):      "any member can let them in",
    ("circle.mjs", "joined"):             "a new family member concerns everyone",
    ("circle.mjs", "Invite code is now"): "old invite links stop working for all",
    ("circle.mjs", "how people join"):    "changes the door for everyone",
    ("circle.mjs", "left"):               "everyone should know who is in",
    ("events.mjs", "SOS"):                "an emergency is everyone's business",
    ("events.mjs", "STILL NOBODY"):       "nobody answered - shout louder",
    ("events.mjs", "is on it"):           "so nobody else duplicates the trip",
    ("events.mjs", "alright"):            "stop the whole family worrying",
    ("events.mjs", "on now"):             "a live call is open to all",
    ("events.mjs", "could do with a call"): "the point of the pulse",
    ("care.mjs",   "needs a hand"):       "a job anyone can pick up",
    ("_tasks.mjs", "payload, {})"):       "late, and nobody has it - or the family chose to tell everyone",
    ("_tasks.mjs", "Nobody has it yet - first to tap"): "its time has come and nobody has it: anyone may take it",
    ("plans.mjs",  ""):                   "a plan invites the whole circle",
    ("games.mjs",  "lobby is open"):      "an open lobby invites everyone",
    ("_ladder.mjs", "Calling "):          "nobody answered an SOS: everyone sees who is being called next",
    ("_staff.mjs", "not marked in yet"):  "anyone in the family may be the one who can check at home",
    ("_renewals.mjs", "payload, {})"):    "a household date nobody looks after yet: anyone may take it",
    ("_bond.mjs", "Plan it together on Parwah"): "a festival the circle itself chose, once, 14 days ahead",
    ("_famlink.mjs", "asks to link family trees"): "another family asks to link trees: any adult of this one may be the one who answers",
    ("_remember.mjs", "A quiet day to remember"): "a day of remembrance is the whole family's, once a year",
}
def _push_calls(src):
    out = []
    for m in re.finditer(r"pushCircle\(", src):
        i, depth = m.end(), 1
        while depth and i < len(src):
            if src[i] == "(": depth += 1
            elif src[i] == ")": depth -= 1
            i += 1
        out.append(src[m.start():i])
    return out
broadcasts, targeted = [], 0
for f in sorted(API_DIR.glob("*.mjs")):
    if f.name == "_push.mjs": continue
    for call in _push_calls(f.read_text(encoding="utf-8")):
        # A targeted push names only: or except: somewhere in its options; a
        # broadcast passes {} or nothing. Scanning the whole call avoids
        # depending on the payload being a literal object.
        if re.search(r"\{\s*(only|except)\s*:", call):
            targeted += 1; continue
        # Titles are built by concatenation, so the first string literal is
        # only a prefix - match the fragment anywhere in the call.
        if not any(f.name == fn and (frag == "" or frag in call) for (fn, frag) in CIRCLE_WIDE_OK):
            t = re.search(r"title:\s*'([^']*)", call)
            broadcasts.append(f"{f.name}: {(t.group(1) if t else call[:40])[:44]}")
check(f"notifications: every circle-wide push is a deliberate one ({targeted} targeted)",
      not broadcasts, "; ".join(broadcasts[:4]))
games = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("notifications: game news reaches the players, not the family",
      "pushPlayers" in games and "!isBot(p)" in games)
check("games: you can play alone, against a named opponent",
      "export const BOT" in games and "soloPlayers" in games and "tttBotCell" in games)
check("games: a solo game is never announced to the family",
      "if (!solo)" in games and "not announced to the family" in games)
check("games: the bot flag survives seating, or a solo duel freezes",
      "const seat = (p)" in games)

# SEVERAL GAMES AT ONCE. A circle used to be allowed exactly one game: every
# start handed back the game already running, so a second family could not
# play while the first was mid-board, and two Snakes and Ladders games were impossible.
glist = (API_DIR / "_gamelist.mjs").read_text(encoding="utf-8")
check("games: starting never hands back the game already running",
      "const existing = await activeGame" not in games and "activeGames(sql" in games)
check("games: the list is what a GET returns, not one game",
      "games," in games and "gameSummary(g, me.id)" in games)
check("games: one game can still be fetched on its own",
      "isUuid(q.game)" in games and "That game is over or was ended" in games)
check("games: the list leads with what is waiting on you",
      "s.myTurn ? 0 : s.mine ? 1 : 2" in games)
check("games: two of the same kind are told apart by number",
      "gameName" in glist and "' ' + Number(n)" in glist)
check("games: numbering counts from the highest still running, not the count",
      "numberAfter" in glist and "if (n > max) max = n" in glist)
check("games: a new game records who started it",
      "state.by = me.name" in games and "state.byId = me.id" in games)
check("games: an open lobby is named, so 'join the game' is followable",
      "pick ' + label + ' and tap" in games)
check("games: the number of games at once is capped, and says so",
      "MAX_ACTIVE" in glist and "atCap(sql" in games and "CAP_MSG" in games)
check("games: only someone playing a game can end it",
      "Only someone playing this game can end it" in games)
check("games: the list logic imports nothing, so the gate can test it early",
      not re.search(r"^\s*import\s", glist, re.M))
check("games: the list logic is unit-tested by the gate",
      (REPO / "site/tests/gametest.mjs").exists()
      and "gametest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
app_games = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("games: the app opens on the list of games, not inside one",
      'id="game-list"' in app_games and 'id="glist"' in app_games)
check("games: every row says whose turn it is, not by colour alone",
      "Your turn ·" in app_games and "gturn" in app_games and "needsyou" in app_games)
check("games: there is a way back out of an open game",
      'id="g-back"' in app_games and "showGameList()" in app_games)
check("games: an open game says which game it is",
      'id="gm-name"' in app_games)
check("games: the app says you may run more than one at a time",
      "more than one at a time" in app_games)
check("games: a poll refreshes the open game by its own id",
      "'&game=' + encodeURIComponent(curGame.id)" in app_games)
check("games: the list is exercised in a real browser",
      (REPO / "site/tests/browser/games.browser.mjs").exists()
      and "games.browser.mjs" in (REPO / "package.json").read_text(encoding="utf-8"))

# A browser suite that dies on EADDRINUSE teaches people to ignore red runs.
_bsuites = sorted((REPO / "site/tests/browser").glob("*.browser.mjs"))
check("browser suites: every one exists and is wired into npm run test:browser",
      len(_bsuites) >= 6 and all(b.name in (REPO / "package.json").read_text(encoding="utf-8") for b in _bsuites))
check("browser suites: none binds a fixed port",
      all(not re.search(r"listen\(\s*8\d{3}", b.read_text(encoding="utf-8")) for b in _bsuites))
check("browser suites: each takes the port it was actually given",
      all("listen(0," in b.read_text(encoding="utf-8") and "address().port" in b.read_text(encoding="utf-8") for b in _bsuites))
check("browser suites: every one degrades gracefully without playwright",
      all("playwright-core is not installed" in b.read_text(encoding="utf-8") for b in _bsuites))

# EKTA WITH NO CREDIT. The Anthropic key ran out, every tier of the cascade
# returned the same account-level refusal, the driver threw, and the whole
# assistant screen died. A family must never be shown a crash where an
# answer was possible.
ekta = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
elocal = (API_DIR / "_ektalocal.mjs").read_text(encoding="utf-8")
eself = (API_DIR / "_ektaselftest.mjs").read_text(encoding="utf-8")
check("ekta: no credit is recognised as an account fact, not a model fact",
      "isBillingFailure" in elocal and "credit balance is too low" in elocal)
check("ekta: a dead key stops the cascade instead of failing three times",
      "if (isDeadKey(e)) break;" in ekta)
check("ekta: an overload still cascades, because a retry can help there",
      "isDeadKey" in elocal and "isAuthFailure" in elocal)
check("ekta: every provider failing ends in an answer, never a throw",
      "throw new Error('All providers failed" not in ekta and "localTurn(sql, circle, me, history, reason)" in ekta)
check("ekta: with no key at all she still answers from the records",
      "noBrain" in ekta and "localTurn(sql, circle, me, history, 'none')" in ekta)
check("ekta: the offline answer is retrieval, through the same tools",
      "prepare_summary" in ekta and "get_family_memory" in ekta and "get_circle" in ekta)
check("ekta: a degraded turn is refunded, not charged for",
      "if (out.offline) { await refund(); " in ekta)
check("ekta: the reason is named, not hidden behind 'something went wrong'",
      "failureReason" in ekta and "offlineNote" in elocal)
check("ekta: the offline answer still refuses to diagnose",
      "not medical advice" in elocal and "No diagnosis, no advice" in elocal
      and "must not be presented as any kind of diagnosis" in ekta)
check("ekta: what is NOT recorded is read out too",
      "Not recorded, so please carry or ask for it" in elocal)
check("ekta: the probe says whether a model answered or the records did",
      "model_live" in eself and "brain" in eself and "offline_answers_from_records" in eself)
check("ekta: the probe tests the degraded path rather than assuming it",
      "offline_never_diagnoses" in eself and "offline_says_why" in eself)
_el_imports = re.findall(r"^\s*import\s.*?from\s+'([^']+)'", elocal, re.M)
check("ekta: the retrieval logic imports nothing but the plain country table, so the gate tests it early",
      set(_el_imports) <= {"./_countries.mjs"} and len(re.findall(r"^\s*import\s", elocal, re.M)) == len(_el_imports)
      and not re.search(r"^\s*import\s", (API_DIR / "_countries.mjs").read_text(encoding="utf-8"), re.M), str(_el_imports))
check("ekta: the retrieval logic is unit-tested by the gate",
      (REPO / "site/tests/ektatest.mjs").exists()
      and "ektatest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
_appe = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("ekta: the app says plainly when she is reading from records",
      'id="ekta-offline"' in _appe and "Answering from your family records" in _appe)
check("ekta: and says the degraded answer cost no coins",
      "This answer is free." in _appe)

# SIGNING UP, SIGNING IN, AND MOVING BETWEEN FEATURES.
_appf = (REPO / "site/public/index.html").read_text(encoding="utf-8")
# --cream is the token for text ON a dark ground, so in dark it equals --ink.
# A card that used it as a BACKGROUND painted white on white, and a new
# family's whole five-card introduction was invisible in dark mode.
check("flow: no card paints --cream under --ink, which is the same colour in dark",
      not re.search(r"background:var\(--cream\)[^}]*color:var\(--ink\)", _appf))
check("flow: the introduction card sits on a real surface token",
      ".coachbox{position:absolute;left:14px;right:14px;background:var(--surface)" in _appf)
# padding:0 put nineteen controls, Sign out and Edit profile among them, at
# sixteen pixels tall.
check("flow: text controls are a thumb tall, not a hairline",
      ".linkbtn{" in _appf and "min-height:44px" in _appf.split(".linkbtn{")[1].split("}")[0])
check("flow: the senior's own switch is tappable",
      "min-height:44px" in _appf.split(".seniorchk{")[1].split("}")[0]
      and "width:24px;height:24px" in _appf)
check("flow: the menu button, a phone's only route to seven features, is 44px",
      "min-width:44px;min-height:44px" in _appf.split("#hamb{")[1].split("}")[0])
# Every tab switch REPLACED the history entry, so Back left the app.
check("flow: switching a tab pushes history, so Back steps back",
      "history.pushState({ tab: t }" in _appf)
check("flow: and the app listens for Back and Forward",
      "addEventListener('popstate'" in _appf and "navPop" in _appf)
check("flow: Back inside a chat or a game steps out before changing tab",
      "if (curChat && t === 'chat') { closeChat(); }" in _appf)
# Submitting the name step empty repainted a byte-identical screen.
check("flow: an empty name is refused out loud",
      "Please type your name so your family knows who joined." in _appf)
check("flow: and a sign-in error is scrolled to, on a screen taller than a phone",
      "function authErr(" in _appf and "scrollIntoView({ block: 'center'" in _appf)
check("flow: a number nobody has seen before is told it is new",
      'id="au-newnote"' in _appf and "This number is new to Parwah" in _appf)
check("flow: signing up, signing in and navigating are walked in a browser",
      (REPO / "site/tests/browser/flow.browser.mjs").exists()
      and "flow.browser.mjs" in (REPO / "package.json").read_text(encoding="utf-8"))

# THE WHOLE DAY WAS YESTERDAY'S. A Julian day at midnight UTC ends in .5, so
# flooring it picked the day number whose solar noon had already passed, and
# every sunrise, sunset, Choghadiya, Rahu Kaal and Abhijit came out for the
# day before the one asked for. Consecutive days differ by about a minute, so
# the times still looked almanac-shaped and nothing caught it.
_pan = (API_DIR / "_panchang.mjs").read_text(encoding="utf-8")
check("day: the day number is ceiled, not floored, off a midnight Julian day",
      "Math.ceil(jd - 2451545.0 + 0.0008)" in _pan and "Math.floor(jd - 2451545.0" not in _pan)
check("day: the arithmetic reads the date, not the time of day handed in",
      "julianMidnightUTC" in _pan and "getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()" in _pan)
check("day: the test asserts the day asked for is the day answered",
      "the day asked for is the day answered" in (REPO / "site/tests/daytest.mjs").read_text(encoding="utf-8"))

# ONE FAMILY'S DATA MUST NOT REACH ANOTHER'S SCREEN.
_sec = (API_DIR / "_sec.mjs").read_text(encoding="utf-8")
_appx = (REPO / "site/public/index.html").read_text(encoding="utf-8")
_events = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_care = (API_DIR / "care.mjs").read_text(encoding="utf-8")
_book = (API_DIR / "book.mjs").read_text(encoding="utf-8")
_ekta = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
_keys = (API_DIR / "_keys.mjs").read_text(encoding="utf-8")
_vault = (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8")
_circle = (API_DIR / "circle.mjs").read_text(encoding="utf-8")
_auth = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
_eself = (API_DIR / "_ektaselftest.mjs").read_text(encoding="utf-8")
_db2 = (API_DIR / "_db.mjs").read_text(encoding="utf-8")

# Stored XSS: esc() escaped &, < and > but not quotes, and its output sits
# inside double-quoted attributes in ten places.
check("xss: the escaper handles quotes, not just angle brackets",
      "'\"': '&quot;'" in _sec and "&#39;" in _sec)
check("xss: the app's own escaper matches the module the gate tests",
      "'\"':'&quot;'" in _appx and "&#39;" in _appx
      and "d.textContent = s; return d.innerHTML" not in _appx)
check("xss: an image data uri is validated whole, not by its prefix",
      "safeImageUri" in _sec and "={0,2}$/" in _sec
      and "safeImageUri" in (API_DIR / "chats.mjs").read_text(encoding="utf-8")
      and "safeImageUri" in _appx)
check("xss: svg is not an accepted image type, because it carries script",
      "svg" not in _sec.split("IMG_URI")[1].split("\n")[0])

# An invite code is a doorbell, not a key.
check("access: there is one guard that says the caller must be in the circle",
      "export async function requireMember" in _db2)
check("access: the home feed no longer opens to a bare invite code",
      "requireMember(sql, q.circle, q.member, tokenOf(req))" in _events)
check("access: nor do reminders, requests and suggestions",
      "requireMember(sql, q.circle, q.member, tokenOf(req))" in _care)
check("access: the feed returns member_id, so your own events are not unread to you",
      "e.member_id, m.name as member_name" in _events)

# Private Family Memory leaked four ways.
check("privacy: a private entry is not named in the circle feed",
      "feedName" in _book and "from './_sec.mjs'" in _book)
check("privacy: care suggestions are scoped to who is asking",
      "careSuggestions(sql, circleId, memberId)" in _care and "ba.member_id is not null" in _care)
check("privacy: Ekta cannot read entries the asker may not open",
      _ekta.count("ba.member_id is not null") >= 2)
check("privacy: only the subject can move an entry to a new subject",
      "can change who it is about" in _book)

# Two features could never succeed: the target overwrote the caller.
check("vault: the person shared with has their own field",
      "body.targetId || body.memberId" in _vault and _vault.count("targetId") >= 4)
check("vault: family memory sharing has the same fix",
      "body.targetId || body.memberId" in _book)
check("vault: the client writes the caller last, so no body can overwrite it",
      "}, body, { code: state.code, memberId: state.memberId })" in _appx)
check("vault: and sends the target under its own name",
      "targetId: who" in _appx and "memberId: who" not in _appx)

# Leaving destroyed records the confirm box never mentioned.
check("leave: what would be destroyed is counted and shown first",
      "needsConfirm" in _circle and "confirmDelete" in _circle)
check("leave: and the app asks again with the real number",
      "doLeave(true)" in _appx)

# One AI key served the whole deployment.
check("keys: a key belongs to the circle that set it",
      "circleKeyName" in _keys and "'pkey_c_' + circleId" in _keys)
check("keys: and one family cannot clear another's",
      "cannot be removed from here" in (API_DIR / "_keysapi.mjs").read_text(encoding="utf-8"))
check("keys: the probe that spends credits needs a key and a rate limit",
      "PARWAH_DIAG_SECRET" in _eself and "rateLimit(sql, 'ektaprobe'" in _eself)

# The app's own polling spent the sign-in budget.
check("auth: a background refresh is not counted as a sign-in attempt",
      "authrefresh" in _auth and "body.refresh === true" in _auth)
check("auth: and the app marks its background reads as refreshes",
      _appx.count("refresh: true }") >= 5)
check("auth: editing a profile carries the country code with the number",
      "numberChanged" in _appx and "cc: numberChanged ?" in _appx)

# Silence is not a state.
check("states: a failed load says so instead of holding the last screen",
      "function loadFail(" in _appx and "function homeOffline(" in _appx)
check("states: and offers a way to try again",
      "data-retryload" in _appx)
check("states: the two Home widgets do not sit on Loading for ever",
      "'Could not load'" in _appx and "'Offline'" in _appx)
check("states: the security rules are unit-tested by the gate",
      (REPO / "site/tests/sectest.mjs").exists()
      and "sectest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))

# THE PROMPT BOOK. Everything here was built by prompting Claude Code, so
# the prompts are part of the source. A book that drifts from the app is
# worse than none: someone follows it and gets a different thing.
_pb_path = REPO / "docs/PROMPTS.md"
check("prompts: the build book exists", _pb_path.exists())
_pb = _pb_path.read_text(encoding="utf-8") if _pb_path.exists() else ""
# One section per feature the app actually has.
for _area in ["Sign-in and profile", "Circles", "Home", "Chat", "Ekta",
              "Care", "Family Memory", "The Vault", "The Day", "Fun",
              "Plans", "Emergency card", "Together", "people screens",
              "voice", "app shell", "public pages", "platform"]:
    check(f"prompts: the book covers {_area}", _area.lower() in _pb.lower())
check("prompts: it carries the standing rules, not just the tasks",
      "The standing prompt" in _pb and "Zero medical or therapeutic claims" in _pb)
check("prompts: it says to run the gate after every change",
      "npm test" in _pb and "EVERY change" in _pb)
check("prompts: it asks for the test in the same breath as the fix",
      "FAILS BEFORE AND PASSES AFTER" in _pb)
check("prompts: it names the traps that actually cost us",
      "midnight ends in .5" in _pb          # the day was yesterday's
      and "doorbell, not a key" in _pb      # an invite code is not identity
      and "prefix check is not a validation" in _pb  # the image data URI
      and "padding:0" in _pb                # sixteen-pixel controls
      and "curl -f" in _pb)                 # the discarded verdict body
check("prompts: it includes the audit and the refute passes, not just the build",
      "trying to REFUTE" in _pb and "Skipping a finding is not a verdict" in _pb)
check("prompts: it states the bar for a 5 in plain terms",
      "68-year-old parent" in _pb)
# The book is copy, so the copy rules apply to it too.
check("prompts: no em dash in the book", "\u2014" not in _pb)
# The banned words appear in the book because it is the book that bans
# them, and that declaration WRAPS over three lines, so a line filter does
# not reach it. Cut the whole clause, from "Banned:" to "Allowed:".
_pb_prose = re.sub(r"Banned:.*?Allowed:", "", _pb, flags=re.S)
for _banned in ["cure", "clinically proven", "doctor recommended", "pain relief"]:
    check(f"prompts: the book does not itself make a {_banned} claim",
          not re.search(r"\b" + re.escape(_banned) + r"s?\b", _pb_prose, re.I))
check("prompts: and it does state the ban somewhere",
      "Banned:" in _pb and "cure" in _pb)
check("prompts: no key, token or connection string is pasted into it",
      not re.search(r"(sk-ant-|postgres://|AIza[0-9A-Za-z\-_]{20,}|xai-|sk-proj-)", _pb))
check("prompts: the book is not shipped to the public site",
      not (REPO / "site/public/docs").exists())

# ANALYTICS: MEASURE THE FUNNEL, LEAVE THE FAMILY ALONE.
_an_path = REPO / "site/public/analytics.js"
check("analytics: the tracking file exists", _an_path.exists())
_an = _an_path.read_text(encoding="utf-8") if _an_path.exists() else ""
# Discovered, like every other page scan here. This was a list of five
# filenames, so a marketing page added later would have shipped unmeasured
# and nobody would have known until the funnel had a hole in it.
# /demo/ counts as marketing for this purpose even though it is an app:
# it is a page we send traffic to.
# The app is excluded by being the app, wherever it lives - it moved from
# /app/ to the root, and a path-based rule would have demanded analytics on it.
_measured = [q for q in PAGES if q != APP_PAGE]
check("analytics: there are marketing pages to measure", len(_measured) >= 5,
      f"{len(_measured)} pages")
for _mp in _measured:
    check(f"analytics: {_mp.relative_to(ROOT / 'public')} is measured",
          "analytics.js" in _mp.read_text(encoding="utf-8"))
# THE APP IS NOT. The home page promises "Reassurance, never surveillance",
# and the app is where a family keeps health facts, documents and addresses.
_app_t = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("analytics: the app is NOT measured, because the promise is not surveillance",
      "analytics.js" not in _app_t)
check("analytics: and the app carries no Google tag of its own",
      "googletagmanager" not in _app_t and "gtag(" not in _app_t)
check("analytics: the file says why the app is exempt, so nobody adds it later",
      "It is not loaded by the app" in _an)
# Nothing may reach Google before a real choice.
check("analytics: ships inert until an ID is pasted in", "var GA4 = ''" in _an)
check("analytics: with no ID there is no bar and no request", "if (!GA4) return;" in _an)
check("analytics: the tag is fetched on consent, not hard-coded into the page",
      "document.createElement('script')" in _an and _an.count("googletagmanager") == 1)
check("analytics: the answer is remembered", "localStorage.setItem(KEY" in _an)
check("analytics: Do Not Track is already an answer", "doNotTrack" in _an)
check("analytics: no advertising signals, and the IP truncated",
      "allow_google_signals: false" in _an and "anonymize_ip: true" in _an)
check("analytics: a click before consent is held, not lost",
      "if (queue.length < 20) queue.push" in _an)
# One conversion, however it is reached.
check("analytics: joining the list is one event, with the route recorded",
      "'join_waitlist'" in _an and "method: 'whatsapp'" in _an and "method: 'email'" in _an)
check("analytics: the steps toward the app are counted too",
      "'open_app'" in _an and "'open_demo'" in _an and "'open_install'" in _an)
check("analytics: the promise is proved in a browser, not just asserted here",
      (REPO / "site/tests/browser/analytics.browser.mjs").exists()
      and "analytics.browser.mjs" in (REPO / "package.json").read_text(encoding="utf-8"))

# SIGN-IN. A phone number was the whole key: type one that exists and you
# were in, as that person, with their family's vault. And every later
# request proved who it was by sending a member UUID that the server hands
# to everyone in the circle.
_au = (API_DIR / "_auth.mjs").read_text(encoding="utf-8")
_authmjs = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
_dbs = (API_DIR / "_db.mjs").read_text(encoding="utf-8")
_appa = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("signin: a PIN is required, so a number alone is not the key",
      "pinError" in _au and "verifyPin" in _authmjs and "needPin" in _authmjs)
check("signin: the PIN is salted and run through a real KDF, not hashed once",
      "scryptSync" in _au and "randomBytes(16)" in _au)
check("signin: PINs are compared in constant time",
      "timingSafeEqual" in _au)
check("signin: the PINs a thief tries first are refused",
      "'1234'" in _au and "'0000'" in _au)
check("signin: wrong PINs lock the account rather than allowing a million tries",
      "MAX_TRIES" in _au and "locked_until" in _authmjs and "lockMessage" in _authmjs)
# One secret for everyone: a PIN of exactly 4 numbers (owner, 2026-10-04).
# An older PIN or a password signs in once, then a 4-number PIN is chosen
# before any session is issued.
check("signin: a PIN of exactly 4 numbers, and no password option",
      "PIN_LEN = 4" in _au and "PASS_MIN" not in _au and "PIN_MAX" not in _au
      and "SECRET_V = 3" in _au)
check("signin: an older PIN or password is marked, and replaced before a session is issued",
      "add column if not exists secret_v" in _dbs and "changeSecret: true" in _authmjs
      and 0 < _authmjs.find("if (user.secret_v !== SECRET_V) {") < _authmjs.find("const token = newToken()"))
# The try is claimed in the database, while unlocked, BEFORE the PIN is
# checked. Read-check-then-write let a burst of guesses all be checked.
_claim = re.search(r"pin_tries = pin_tries \+ 1\s+where id = \$\{user\.id\} and \(locked_until is null or locked_until <= now\(\)\)", _authmjs)
check("signin: each try is claimed before it is checked, so a burst cannot beat the lock",
      _claim is not None and _claim.start() < _authmjs.find("verifyPin(body.pin, user.pin_salt, user.pin_hash)"))
check("signin: a background refresh proves itself with the session, not a PIN",
      "sessionUser(sql, tokenOf(req))" in _authmjs and "su.user_id === user.id" in _authmjs)
_pinbox = _appa.split('id="au-pin"')[1][:200]
check("signin: the box takes 4 numbers on the number pad, typed out of sight",
      re.search(r'<input type="password" id="au-pin"', _appa) is not None
      and 'id="au-pin2"' in _appa and 'maxlength="4"' in _pinbox and 'inputmode="numeric"' in _pinbox)
check("signin: no copy still offers a password at sign-in",
      "PIN or password" not in _appa.split('id="auth-step"')[1].split('</div>\n  </div>')[0]
      and "Choose a PIN or password" not in _appa)
_old_copy = re.findall(r"6-number|[Ss]ix numbers|(?<!to )\b6 numbers", _appa)
check("signin: no copy still asks for six numbers", not _old_copy, ", ".join(_old_copy))
check("signin: the lock and the old-PIN path are tested against a real database",
      (REPO / "site/tests/db/signin.dbtest.mjs").exists()
      and "test:db" in (REPO / "package.json").read_text(encoding="utf-8")
      and "npm run test:db" in (REPO / ".github/workflows/pr.yml").read_text(encoding="utf-8"))
check("signin: a session token is issued, and only its hash is stored",
      "newToken()" in _authmjs and "tokenHash(token)" in _authmjs and "createHash('sha256')" in _au)
check("signin: sessions expire", "SESSION_DAYS" in _au and "expires_at" in _dbs)
check("signin: signing out revokes the session on the server",
      "action === 'signout'" in _authmjs and "delete from sessions" in _authmjs)
check("signin: and there is a way to sign out everywhere, for a lost phone",
      "signout_all" in _authmjs)
# No SMS provider, so the family is the trust anchor. It is also a better
# one: they know your face and your voice.
check("signin: a forgotten PIN is recovered by the family, not by SMS",
      "reset_request" in _authmjs and "reset_approve" in _authmjs)
check("signin: the person asking cannot approve their own reset",
      "Someone else in the family has to approve this, not you" in _authmjs)
check("signin: a reset request never reveals whether a number is registered",
      "says nothing about\n      // whether a number is registered" in _authmjs)
# A yes lets in the device that asked, and no other; once in, the lost
# phone's sessions end. security.dbtest.mjs tries both for real.
check("signin: a reset is used with the asking device's secret, and ends old sessions",
      "secret_hash = ${tokenHash(body.resetSecret)}" in _authmjs
      and "delete from sessions where user_id = ${user.id}" in _authmjs)
# The token, not the UUID, says who is calling.
check("signin: there is one guard, and it checks the token",
      "export async function sessionUser" in _dbs and "AUTH_REQUIRED" in _dbs)
check("signin: a membership must belong to whoever holds the token",
      "That is not your membership" in _dbs)
check("signin: authentication is on unless deliberately switched off",
      "process.env.PARWAH_AUTH || 'on'" in _dbs)
# _owned.mjs and _db.mjs ARE the guards: the lookup belongs there, and there
# it is followed by the ownership test. Everywhere else it is the bug.
_GUARD_FILES = {"_owned.mjs", "_db.mjs"}
_inline = [p.name for p in sorted(API_DIR.glob("*.mjs"))
           if p.name not in _GUARD_FILES
           and "from members where id = ${memberId} and circle_id" in p.read_text(encoding="utf-8")]
check("signin: no route still authorises by bare member UUID",
      not _inline, ", ".join(_inline))
_owned = (API_DIR / "_owned.mjs").read_text(encoding="utf-8")
check("signin: and the guard itself checks the token owns that membership",
      "sessionUser(sql, token)" in _owned and "rows[0].user_id !== u.user_id" in _owned)
check("signin: the token travels in a header, not a query string",
      "x-parwah-token" in (API_DIR / "_token.mjs").read_text(encoding="utf-8"))
check("signin: the app sends it on every read and every write",
      "function apiGet(" in _appa and "X-Parwah-Token" in _appa
      and "fetch(API." not in _appa.replace("fetch(API.push)", ""))
check("signin: an expired session lands on sign-in, not on silent failures",
      "function checkSignedOut(" in _appa)
check("signin: the PIN rules are unit-tested by the gate",
      (REPO / "site/tests/authtest.mjs").exists()
      and "authtest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))

# WHAT A STRANGER LEARNS WHEN SOMETHING BREAKS, AND WHAT THEY CAN MAKE
# HAPPEN. Every route sent e.message straight to the caller, and Postgres
# names the schema in its errors. The diagnostics probes were open to the
# world and every one of them WRITES.
_failmod = (API_DIR / "_fail.mjs").read_text(encoding="utf-8")
_diag = (API_DIR / "diag.mjs").read_text(encoding="utf-8")
_verify = (REPO / "ops/verify-live.sh").read_text(encoding="utf-8")
check("leak: there is one place that decides what an error says",
      "export function fail(" in _failmod and "export function failDb(" in _failmod)
check("leak: the real error goes to the server log, not the browser",
      "console.error('[parwah " in _failmod)
check("leak: and the caller gets a reference to quote back",
      "ref ' + ref" in _failmod and "randomBytes(4)" in _failmod)
_leaky = sorted(p.name for p in API_DIR.glob("*.mjs")
                if "error: String(e && e.message || e)" in p.read_text(encoding="utf-8")
                and p.name not in {"_selftest.mjs", "_health.mjs", "_ektaselftest.mjs", "ekta.mjs"})
check("leak: no route returns a raw database error to the caller",
      not _leaky, ", ".join(_leaky))
# The probes create circles, members, chats, vault rows and coin ledger
# entries on every hit. Open, that is an unauthenticated write endpoint.
check("leak: the probes that write need the diagnostics key",
      "function authorised(req)" in _diag and "PARWAH_DIAG_SECRET" in _diag)
check("leak: with no key configured they stay off rather than open",
      "stay off until PARWAH_DIAG_SECRET is set" in _diag)
check("leak: the liveness check is open but touches nothing",
      "Liveness only" in _diag and "db_configured" in _diag)
check("leak: the deploy verifier sends the key, in a header and never the address",
      '-H "X-Diag-Key: $DIAG_KEY"' in _verify and "key=$DIAG_KEY" not in _verify)
check("leak: the server reads the key from the header only, in constant time",
      "req.query && req.query.key" not in _diag and "timingSafeEqual(a, b)" in _diag)
check("leak: and refuses to run without it, rather than reporting a false red",
      "PARWAH_DIAG_SECRET is not set here" in _verify)
# Nothing private may ever be served.
_vign = (REPO / ".vercelignore").read_text(encoding="utf-8")
for _p in ("hq/", ".claude/", "CLAUDE.md", "merge/"):
    check(f"leak: {_p} can never be uploaded", _p in _vign)
# merge/ holds the source of the deleted parwah-site repo while the two
# brands are merged into one. It has not been through this repo's claims
# guardrails, so the one thing that must stay true is that none of it is
# served. Being outside site/public is what makes that true, so assert it
# rather than trust it.
_staged = sorted((REPO / "merge").rglob("*.html")) if (REPO / "merge").exists() else []
_served = [str(f.relative_to(REPO)) for f in _staged
           if "public" in f.relative_to(REPO).parts]
check("leak: staged merge copy is never served",
      not _served, ", ".join(_served[:3]))
check("leak: the build serves only site/public",
      "cp -r site/public public" in (REPO / "package.json").read_text(encoding="utf-8"))

# DEPLOYING WITHOUT A LAPTOP. Vercel's git integration stopped creating
# deployments, and ops/deploy.sh needs a machine that can reach
# api.vercel.com - which the development sandbox cannot. Eleven commits of
# security fixes sat on main undeployed for a day because of that.
_wf_path = REPO / ".github/workflows/deploy.yml"
check("deploy: there is a workflow that ships without a laptop", _wf_path.exists())
_wf = _wf_path.read_text(encoding="utf-8") if _wf_path.exists() else ""
check("deploy: it fires on every push to main", "branches:" in _wf and "- main" in _wf)
check("deploy: and can be re-run by hand after a failure", "workflow_dispatch" in _wf)
check("deploy: one at a time, and never cancelled midway",
      "group: deploy-production" in _wf and "cancel-in-progress: false" in _wf)
# Order matters: the gate cannot run after the deploy and mean anything.
_gate_at = _wf.find("npm test")
_ship_at = _wf.find("vercel deploy --prod")
_verify_at = _wf.find("ops/verify-live.sh")
check("deploy: the gate runs BEFORE production, not after",
      0 < _gate_at < _ship_at)
check("deploy: and the live database is proved AFTER, or it is a rumour",
      0 < _ship_at < _verify_at)
check("deploy: source is deployed so the Vercel build runs the gate again",
      "--prebuilt" not in _wf)
# A deploy that ships and then cannot be verified is worse than one that
# never started, so the secrets are checked before anything can half-succeed.
check("deploy: it names the missing secret before doing anything",
      "Missing repository secret" in _wf
      and _wf.find("Missing repository secret") < _ship_at)
# Every VERCEL_TOKEN must be set FROM the secret store, never assigned a
# literal. Matching the variable's name is not the test; matching a value is.
_tok_assign = re.findall(r"VERCEL_TOKEN:\s*(\S+)", _wf)
check("deploy: the token only ever comes from the secret store",
      bool(_tok_assign) and all(t.startswith("${{") for t in _tok_assign),
      ", ".join(t for t in _tok_assign if not t.startswith("${{")))
check("deploy: and no credential is written into the workflow",
      not re.search(r"(?<![\w$.{])[A-Za-z0-9]{24}(?![\w}])", _wf))
# The gate passing on a full checkout is not the gate passing on Vercel: the
# upload is stripped by .vercelignore first. CI builds that exact input.
_vi = REPO / "ops/vercel-input.sh"
check("deploy: there is a way to build exactly what Vercel receives", _vi.exists())
check("deploy: and CI builds that input BEFORE shipping, not after",
      0 < _wf.find("ops/vercel-input.sh") < _wf.find("vercel deploy --prod"))
check("deploy: it strips by .vercelignore, the same list Vercel uses",
      _vi.exists() and ".vercelignore" in _vi.read_text(encoding="utf-8"))
check("deploy: a failure is reported rather than passing quietly",
      "if: failure()" in _wf and "Deploy FAILED" in _wf)
check("deploy: and the run says what went live",
      "GITHUB_STEP_SUMMARY" in _wf and "Live at" in _wf)
# CI must prove the gate on the runtime the gate is developed on. Node 20
# is deprecated on the runners and is silently forced to 24, so a run that
# pins it is testing a third thing nobody uses.
_wf_node = re.search(r"node-version:\s*(\d+)", _wf)
check("deploy: CI runs the gate on a current Node, not a deprecated one",
      bool(_wf_node) and int(_wf_node.group(1)) >= 22,
      _wf_node.group(1) if _wf_node else "no node-version pinned")

# EVERY PULL REQUEST MERGES ITSELF - ONCE IT HAS PASSED EVERYTHING. Not
# unconditional: the tests are the only thing between a PR and production.
_pr_path = REPO / ".github/workflows/pr.yml"
check("automerge: there is a workflow for pull requests", _pr_path.exists())
_pr = _pr_path.read_text(encoding="utf-8") if _pr_path.exists() else ""
check("automerge: it runs on every pull request into main",
      "pull_request:" in _pr and "branches: [main]" in _pr
      and all(t in _pr for t in ("opened", "synchronize", "reopened", "ready_for_review")))
check("automerge: it never uses pull_request_target (fork code with write access)",
      "pull_request_target" not in _pr)
# Only what actually runs counts: the header comment names the same commands.
_pr_runs = "\n".join(l.strip() for l in _pr.splitlines()
                      if not l.lstrip().startswith("#"))
_pr_merge_at = _pr_runs.find("gh pr merge")
_pr_merge_cmd = re.findall(r"run: (gh pr merge .*)", _pr_runs)
check("automerge: the merge waits for the tests to pass",
      0 < _pr_runs.find("needs: verify") < _pr_merge_at)
check("automerge: the tests are the same three as a deploy",
      all(0 < _pr_runs.find("run: " + step) < _pr_runs.find("needs: verify") for step in
          ("npm test", "bash ops/vercel-input.sh", "npm run test:browser")))
check("automerge: it merges exactly the commit that was tested",
      len(_pr_merge_cmd) == 1 and '--match-head-commit "$SHA"' in _pr_merge_cmd[0]
      and "SHA: ${{ github.event.pull_request.head.sha }}" in _pr_runs)
check("automerge: drafts and forks never merge themselves",
      "pull_request.draft == false" in _pr_runs
      and "head.repo.full_name == github.repository" in _pr_runs)
check("automerge: commit messages survive the merge (no squash)",
      len(_pr_merge_cmd) == 1 and " --merge " in _pr_merge_cmd[0]
      and "--squash" not in _pr_merge_cmd[0] and "--rebase" not in _pr_merge_cmd[0],
      "; ".join(_pr_merge_cmd))
# A merge made with the workflow token fires no push workflows, so without
# this the deploy would silently never run.
check("automerge: and production deploys after the merge",
      0 < _pr_merge_at < _pr_runs.find("run: gh workflow run deploy.yml"))
# The dispatch reads main when it is sent. Sent in the same second as the
# merge it once deployed the commit before it (PR #92).
check("automerge: the deploy starts only once main holds the merged commit",
      0 < _pr_merge_at < _pr_runs.find('compare/$SHA...main') < _pr_runs.find("run: gh workflow run deploy.yml")
      and '[ "$st" = "ahead" ] || [ "$st" = "identical" ]' in _pr_runs and "exit 1" in _pr_runs)
check("automerge: the only token it uses is the workflow's own",
      set(re.findall(r"GH_TOKEN:\s*(\S+(?: \S+)*)", _pr)) == {"${{ github.token }}"})
_pr_node = re.search(r"node-version:\s*(\d+)", _pr)
check("automerge: it tests on the same Node as the deploy",
      bool(_pr_node) and bool(_wf_node) and _pr_node.group(1) == _wf_node.group(1))

# ---------- 10b. The day: muhurat and rashi ----------
# The point of the section is that a family split across cities sees the SAME
# screen: the parent reads the Choghadiya they have always kept, the grandchild
# in London reads what it means. So the English gloss is not decoration - it is
# the feature, and it is checked.
pan = (API_DIR / "_panchang.mjs").read_text(encoding="utf-8")
horo = (API_DIR / "_horoscope.mjs").read_text(encoding="utf-8")
plc = (API_DIR / "_places.mjs").read_text(encoding="utf-8")
dayapi = (API_DIR / "_dayapi.mjs").read_text(encoding="utf-8")
appday = (REPO / "site/public/index.html").read_text(encoding="utf-8")

check("day: muhurat is computed from sunrise, never fetched",
      "fetch(" not in pan and "import" not in pan.split("export")[0],
      "_panchang.mjs must stay dependency-free and offline")
check("day: every Choghadiya name carries a plain-English meaning",
      all(f"{n}:" in pan and "en:" in pan for n in
          ("Udveg", "Chal", "Labh", "Amrit", "Kaal", "Shubh", "Rog")))
_named = {"rahuKaal": "Rahu Kaal", "gulikaKaal": "Gulika", "yamaganda": "Yamaganda", "abhijit": "Abhijit"}
_unexplained = [k for k, word in _named.items()
                if not re.search(k + r":[^}]*?en:\s*'([^']{40,})'", pan, re.S)
                or word not in (re.search(k + r":[^}]*?en:\s*'([^']{40,})'", pan, re.S).group(1))]
check("day: Rahu Kaal, Gulika, Yamaganda and Abhijit each carry a real English explanation",
      not _unexplained, ", ".join(_unexplained))
check("day: the timings belong to a city, not to the country",
      "placeOf" in dayapi and "me.place" in dayapi and "lat" in plc)
check("day: an unrecognised place is flagged rather than passed off as known",
      "guessed: true" in plc and "mu-guess" in appday)
check("day: all twelve rashis, named in English and Hindi",
      horo.count("hi: '") == 12 and "SIGNS" in horo)
check("day: a horoscope is never invented when the source is unreachable",
      "never a fabrication" in horo and "if (!g.text) continue;" in horo
      and "unavailable" in horo and "rather than inventing one" in appday)
check("day: readings are fetched once a day for the whole family, not per screen",
      "on conflict (day, sign) do nothing" in horo and "create table if not exists horoscope" in horo)
# The screen answers one question - "is now a good time?" - before it shows
# anything else. Sixteen equal cards was the answer to a different question.
check("day: the screen leads with a verdict, not a table",
      "currentPeriod" in pan and "renderMuhurat" in appday
      and "A good time right now" in appday and "Better to wait" in appday)
check("day: and says what to do next, so the verdict is actionable",
      "Next good window:" in appday and "This window ends at" in appday)
# Abhijit is auspicious and once sat under a heading that said "avoid". It
# now has its own tab, "Good times", apart from the times to avoid.
_good_tab = appday[appday.find('id="mp-good"'):appday.find('id="mp-avoid"')]
check("day: an auspicious window is never filed under the times to avoid",
      'id="mu-good"' in _good_tab and 'id="mu-avoid"' not in _good_tab
      and "{ name: 'Abhijit Muhurat', per: p.abhijit, good: true }" in appday)
check("day: the sixteen windows are a reference, folded inside Hourly",
      "All 16 time windows" in appday and 'id="mp-hours"' in appday
      and appday.find('id="mp-hours"') < appday.find('id="mu-day"') < appday.find('id="mp-good"'))
# ONE answer for every moment. Three layers (the Choghadiya, the three times
# to avoid, Abhijit) used to be shown separately, so the same 9:12 am read
# "Chal, good" in one place and "Yamaganda, avoid" in another.
check("day: the verdict, band, coming up and hours all read one timeline",
      "function muTimeline(p)" in appday and "muTimeline(p); muSegs = segs;" in appday
      and re.search(r"\n\s+renderHours\(segs, p, tz\);", appday) is not None
      and "segs.slice(at + 1, at + 6)" in appday)
check("day: the detail is in tabs, and the day opens on the overview",
      'role="tablist"' in appday and 'id="mu-tabs"' in appday
      and "if (t === 'day' && curTab !== 'day') showMuTab('overview');" in appday)
check("day: no city is told apart from an unknown one",
      "unset: true" in plc and "j.place.unset" in appday and 'id="mu-addcity"' in appday)
_coins_src = (API_DIR / "_coins.mjs").read_text(encoding="utf-8")
_earn = _coins_src[_coins_src.index("export const EARN = {"):_coins_src.index("};", _coins_src.index("export const EARN = {"))]
check("keys: a key the family saved can be removed (the card matches what /api/keys reports)",
      "st.src === 'circle' ? ' <button class=\"linkbtn\" data-kclear" in appday
      and "src[p] = 'circle'" in (API_DIR / "_keys.mjs").read_text(encoding="utf-8"))
check("coins: no rule is listed that is never paid (check-ins and medicines earn nothing)",
      "checkin:" not in _earn and "pill:" not in _earn and "game:" in _earn
      and "award(sql, circleId, p.id, 'game'" in (API_DIR / "games.mjs").read_text(encoding="utf-8"))
check("coins: the cost of a question is stated, and nobody is ranked",
      'id="coin-cost"' in appday and "each question to Ekta uses" in appday
      and "Who is keeping things going" not in appday and "Thank you, this month" in appday)
check("day: all twelve signs are behind a disclosure too, yours is not",
      "See all twelve signs" in appday and 'id="ho-mine"' in appday)
check("day: the sign is labelled as a sun sign, plainly, not as a rashi",
      "Your sun sign today" in appday and "Not your Vedic rashi." in appday and "Your sign today" not in appday)
# Good/avoid is a STATUS, and status must never be carried by colour alone.
check("day: the day band never means anything by colour alone",
      "tlkey" in appday and "Better to wait</span>" in appday
      and 'class="sr"' in appday and 'role="img"' in appday)
check("day: the band is drawn in real time, not equal boxes",
      "/ span * 100" in appday and "flex:0 0 " in appday)
# The screen explains the arithmetic to the family, so the explanation has to
# be the truth: the tables are regenerated from the planets, not copied.
check("day: the Choghadiya sequence is derived from the planets, not a copied table",
      "derivedDaySeq" in pan and "derivedNightSeq" in pan and "CHALDEAN" in pan
      and "WEEKDAY_LORD" in pan and "LORD_OF" in pan)
check("day: every period carries the planet that rules it",
      "lord: LORD_OF[n]" in pan and 'mu-lords' in appday)
check("day: Abhijit is the 8th of fifteen muhurtas, not an eighth of the day",
      "dayMs / 30" in pan and "EIGHTH MUHURTA OF FIFTEEN" in pan)
check("day: the day is the member's own day, not the server's",
      "Intl.DateTimeFormat('en-CA', { timeZone: place.tz })" in dayapi)
check("day: the screen explains how the timings are worked out",
      'id="mu-how"' in appday and "How the day is worked out" in appday
      and "eight equal parts" in appday and "NOAA" in appday)
# It computes a tropical sun sign. Calling that a Vedic rashi would be a lie.
check("day: the app never claims to know a rashi it cannot compute",
      "SIGN_BASIS" in horo and "MOON sign" in horo and "must not say that it does" in horo
      and "does not claim" in appday and "moon sign" in appday)
check("day: and says which zodiac the reading is actually written for",
      'id="ho-how"' in appday and "signBasis" in appday and "sun sign" in appday)
check("day: the rashi needs a birthday, and asks for one instead of guessing",
      "ho-nodob" in appday and "e-dob" in appday and "signOf" in horo)
check("day: the day section is reachable from the tabs and the drawer",
      appday.count('data-tab="day"') >= 2 and "'day'" in appday and "refreshDay" in appday)
check("day: the unit test runs in the deploy gate",
      "daytest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("day: a failed day is a sentence a person can read, with a way to try again",
      "function humanFail(" in appday
      and "humanFail(j.error, 'Could not work out today.')" in appday
      and 'data-dayretry="1"' in appday)
check("day: the source is testable from production with one URL",
      "probe=day" in (API_DIR / "diag.mjs").read_text(encoding="utf-8")
      and (API_DIR / "_dayselftest.mjs").exists()
      and "almanac" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8"))
check("day: the probe separates our arithmetic from someone else's uptime",
      "arithmetic: { ok:" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8")
      and "source" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8")
      and "never invents one" in (API_DIR / "_dayselftest.mjs").read_text(encoding="utf-8"))

# ---------- 10c. Knowing what this is, without an account ----------
# Feedback from a tester: "I can't know a lot about this without signing in."
# They were right - on a phone the entry screen was a headline and a phone
# field. The validation guide asks for the same thing from the other side:
# show five narrow concept screens, and NOT the full app.
appob = (REPO / "site/public/index.html").read_text(encoding="utf-8")
check("entry: a phone sees what Parwah is, not only a sign-in box",
      '<div class="obpoints">' in appob and 'class="obpoints deskonly"' not in appob)
check("entry: the explanation is legible on the cream ground, not sidebar grey",
      ".obpoint{display:flex;gap:var(--space-12);align-items:flex-start;font-size:var(--fs-14);line-height:1.45;color:var(--ink-soft)}" in appob)
check("entry: there is a way to see the product before it asks for anything",
      'id="au-see"' in appob and 'id="demo-step"' in appob and "showStep('demo')" in appob)
check("entry: the example is offered before the sign-in form",
      appob.find('id="au-see"') < appob.find('id="auth-step"')
      and "$('au-see').hidden = which !== 'auth'" in appob)
check("entry: an interview can open straight onto the concept",
      "demoWanted()" in appob and "get('demo') === '1'" in appob)
_demo = appob[appob.index("var DEMO = ["):appob.index("var demoAt = 0;")]
check("guide demo: the five screens the guide specifies, then the price",
      all(k in _demo for k in ("'promise'", "'memory'", "'ekta'", "'todo'", "'ready'", "'plan'")) and "'pulse'" not in _demo and "pulse" not in _demo.lower())
check("guide demo: screen 1 is the promise and four people, nothing else",
      "nobody should have to scramble" in _demo and "You decide who can see what" in _demo)
check("guide demo: screen 2 carries the guide's own five sections",
      all(x in _demo for x in ("🩺 Health", "📁 Records", "📞 People to call",
                               "💡 Useful to know", "🕒 Freshness")))
check("guide demo: screen 3 is the readiness number with named gaps",
      "78% ready" in _demo and "insurance card missing" in _demo)
check("guide demo: Ekta retrieves and never diagnoses",
      "Prepare summary" in _demo and "does not diagnose" in _demo)
check("guide demo: things to do shows who has what (and what nobody has yet), with the offline emergency card",
      "Nobody has it yet" in _demo and "It works with no internet." in _demo)
# Honest about money: the free plan has everything, the paid plan is a way
# to support Parwah that is not here yet, and no sum in a second currency
# that did not add up ($29.99 at 85 to the dollar is not 2,499).
check("guide demo: the price comes last and is honest: free for families, a Family Plan coming, no dollar maths",
      "Free" in _demo and "for families" in _demo and "2,499 a year is coming" in _demo
      and "29.99" not in _demo and "to the dollar" not in _demo)
check("guide demo: dates move with the calendar, never a fixed month that goes stale",
      "dDay(" in _demo and "30 September" not in _demo and "12 August" not in _demo)
# "Do NOT show chat, games, gifting, calls or a feature menu here."
_banned = [w for w in ("chat", "game", "gift", "video call", "Snakes", "Antakshari")
           if w.lower() in _demo.lower()]
check("guide demo: none of what the guide forbids on these screens",
      not _banned, ", ".join(_banned))
check("guide demo: it is plainly an example, not someone's real family",
      "not real people" in appob and "nothing is sent anywhere" in appob)

# ---------- 10d. Addresses that are real, not just typed ----------
# A free-text box gives you "S-354, Greater Kailash 2" - no city, no state,
# and no way to know the PIN even matches the locality. India Post publishes
# that mapping free, so six digits fill in the rest.
pin = (API_DIR / "_pin.mjs").read_text(encoding="utf-8")
pinapi = (API_DIR / "_pinapi.mjs").read_text(encoding="utf-8")
appad = (REPO / "site/public/index.html").read_text(encoding="utf-8")

check("address: the PIN rules are dependency-free, like the phone rules",
      "import" not in pin.split("export")[0] and "PIN_SOURCE" in pin)
check("address: six digits, and never one starting 0",
      "p[0] === '0'" in pin and "p.length !== 6" in pin)
check("address: a PIN is fetched once and kept, not on every keystroke",
      "create table if not exists pincode" in pin and "on conflict (pin) do nothing" in pin
      and "where pin = ${pin}" in pin)
check("address: a city is never guessed from a PIN we could not check",
      "unknown: true" in pin and "type the city and state yourself" in pin
      and "nothing here fills a gap with a plausible value" in pin)
check("address: the lookup needs circle membership and is rate limited",
      "requireMember(" in pinapi and "tokenOf(req)" in pinapi and "rateLimit" in pinapi)
# A 404 for an unknown PIN also logs a console error in every browser that
# asks. The circle-not-found 404 above it is a different thing and stays.
check("address: an unknown PIN is a 200 answer, not a 404 error",
      "return res.status(200).json(out)" in pinapi
      and "status(out.ok ? 200 : 404)" not in pinapi)
check("address: the form asks for a PIN and shows what it will save",
      'id="b-pin"' in appad and 'id="b-area"' in appad and 'id="b-city"' in appad
      and 'id="b-state"' in appad and 'id="b-addrfull"' in appad)
check("address: a PIN that cannot be checked is never a locked door",
      "function pinManual" in appad and "saved as you write it" in appad)
check("address: an old free-text address re-saves unchanged",
      "the whole stored line goes back into the first box" in appad)
check("address: the source is checkable from production",
      "probe=pin" in (API_DIR / "diag.mjs").read_text(encoding="utf-8")
      and (API_DIR / "_pinselftest.mjs").exists())
check("address: the unit test runs in the deploy gate",
      "pintest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("memory: every filter carries a word, not just an emoji",
      appad.count('class="bkw"') == 5 and '<button type="button" data-bk="contact">☎️</button>' not in appad)

# ---------- 10e. Nothing half-merged ever ships ----------
# A merge resolved by committing the conflict markers reached origin/main and
# sailed through 200 checks: the HTML validator only reads tags, and "<<<<<<<
# HEAD" is just text to it. It would have rendered, literally, on the family
# memory screen. Cheap to check, so it is checked everywhere.
_srcs = (list((REPO / "api").glob("*.mjs")) + list((REPO / "scripts").glob("*.sh"))
         + list((REPO / "ops").glob("*.sh")) + list((REPO / "site" / "tests").glob("*.py"))
         + list((REPO / "site" / "tests").glob("*.mjs"))
         + list((REPO / "site" / "tests" / "browser").glob("*.mjs"))
         + [p for p in (REPO / "site" / "public").rglob("*.html")]
         + [p for p in (REPO / "site" / "public").rglob("*.js")]
         + [REPO / "vercel.json", REPO / "package.json"])
_conflicted = []
for f in _srcs:
    if not f.is_file():
        continue
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if line.startswith("<<<<<<< ") or line.startswith(">>>>>>> ") or line.rstrip() == "=======":
            _conflicted.append(f"{f.relative_to(REPO)}:{i}")
            break
check(f"merge: no conflict markers anywhere in the source ({len(_srcs)} files)",
      not _conflicted, "; ".join(_conflicted[:4]))

# ---------- 10f. The brand name lives in 350 places ----------
# It appears as Parwah, parwah, PARWAH and परवाह across markup, code, tests,
# the manifest, the service worker, the SVG marks and four filenames. Renaming
# that by hand is how a rename ends up half done, so it is one command.
_ren = (REPO / "ops/rename-brand.sh")
check("brand: renaming is one reviewed command, not a find-and-replace",
      _ren.exists() and _ren.stat().st_mode & 0o111)
if _ren.exists():
    _r = _ren.read_text(encoding="utf-8")
    check("brand: it shows what it would do before it does anything",
          'APPLY=0' in _r and 'Re-run with --apply' in _r)
    check("brand: it handles every form the name takes",
          all(x in _r for x in ("s/Parwah/", "s/parwah/", "s/PARWAH/", "OLD_DEV=")))
    # Renaming these signs every existing user out of their circle.
    check("brand: browser storage keys are left alone unless asked for",
          "STORAGE=0" in _r and "signs every existing user out" in _r
          and "is_browser" in _r)
    check("brand: the sentinel cannot be eaten by the rename it protects",
          "STORAGEKEY" in _r and "PARWAHKEY" not in _r)
    check("brand: the new name is written as bytes, not double-encoded",
          "NO -C layers" in _r and "-CSD" not in _r)
    check("brand: it names what only a human can rename",
          "Vercel project name" in _r and "GitHub repository name" in _r
          and "domain" in _r)

# ---------- 10g. Light and dark ----------
# A second theme is only possible if NOTHING is a bare colour outside the token
# block. These checks are what stop the next feature quietly hardcoding #fff
# into a card and being invisible at night.
_appt = (REPO / "site/public/index.html").read_text(encoding="utf-8")
_css = _appt[_appt.index("<style>"):_appt.index("</style>")]
_dark_end = _css.index("}", _css.index(':root[data-theme="dark"]{'))
_after = _css[_dark_end:]
_loose = re.findall(r"#[0-9A-Fa-f]{3,8}\b", _after)
check(f"theme: every colour is a token, none loose in the components ({len(_loose)} loose)",
      not _loose, ", ".join(sorted(set(_loose))[:6]))

# ---------- 10h. The design language system (docs/design/DESIGN_SYSTEM.md) ----------
# Every spacing, type size, corner, layer and duration is a token. Raw values
# are allowed only inside the token block itself. Layout sizes (56px and up),
# hairlines (1px), zero, em-relative and fluid clamp() type are not rhythm.
_comp = _css[_css.index("}", _css.index(":root{")) + 1:]
_mk = _appt[_appt.index("</style>"):]
_inline = " ;".join(re.findall(r'style=\\?"([^"\\]*)', _mk))
def _decls(text, prop_re):
    return [(m.group(1), m.group(2)) for m in re.finditer(r"(?<![\w-])(" + prop_re + r")\s*:\s*([^;{}\"]+)", text)]
_SP = r"(?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap"
def _raw_space(v):
    bad = []
    for n, u in re.findall(r"(-?\d*\.?\d+)(px|rem)\b", v):
        px = abs(float(n)) * (16 if u == "rem" else 1)
        if px not in (0, 1) and px < 56: bad.append(n + u)
    return bad
_rs = [p + ":" + v for p, v in _decls(_comp + " ;" + _inline, _SP) if _raw_space(v)]
check(f"dls: spacing comes from the 4pt tokens, never raw px ({len(_rs)} raw)", not _rs, "; ".join(_rs[:4]))
# A fluid size is allowed only between two ramp tokens: clamp(var(--fs-14),
# 4vw, var(--fs-20)). A raw bound let a "12px floor" render at 10px.
def _raw_type(v):
    if "clamp" in v:
        inner = re.sub(r"var\(--fs-\d+\)", "", v)
        inner = re.sub(r"-?\d*\.?\d+(vw|vh|vmin|vmax|%)", "", inner)
        return bool(re.search(r"\d(px|rem|em)\b", inner))
    return bool(re.search(r"\d(px|rem)\b", v))
_rf = [v for p, v in _decls(_comp + " ;" + _inline, "font-size") if _raw_type(v)]
check(f"dls: type sizes come from the type ramp ({len(_rf)} raw)", not _rf, "; ".join(_rf[:4]))
_rr = [v for p, v in _decls(_comp + " ;" + _inline, "border-radius") if re.search(r"\dpx\b", v)]
check(f"dls: corners come from the radius tokens ({len(_rr)} raw)", not _rr, "; ".join(_rr[:4]))
_rz = [v for p, v in _decls(_comp + " ;" + _inline, "z-index") if re.fullmatch(r"\s*-?\d+\s*", v)]
check(f"dls: layers are named tokens, never numbers ({len(_rz)} raw)", not _rz, "; ".join(_rz[:4]))
_rt = [v for p, v in _decls(_comp, "transition") if re.search(r"(?<![\w-])\d*\.?\d+m?s\b", v)]
check(f"dls: motion uses the duration tokens ({len(_rt)} raw)", not _rt, "; ".join(_rt[:3]))
_used = set(re.findall(r"var\((--(?:space|fs|radius|z|motion)-[a-z0-9]+)\)", _appt))
_defined = set(re.findall(r"(--(?:space|fs|radius|z|motion)-[a-z0-9]+)\s*:", _css[_css.index(":root{"):_css.index("}", _css.index(":root{"))]))
check("dls: every token used is defined", _used <= _defined, ", ".join(sorted(_used - _defined)))
check("dls: reduced motion switches off every animation, present and future",
      "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important" in _appt)
check("dls: keyboard focus is one visible ring from tokens, in both themes",
      ":focus-visible{outline:3px solid var(--focus-ring)" in _appt and "outline:none" not in _css and "outline:0;" not in _css)
_today_doc = (REPO / "docs" / "design" / "TODAY.md").read_text(encoding="utf-8")
_wgrid = re.search(r'<div class="widgets" id="widgets">(.*?)</div>', _appt, re.S).group(1)
_wnames = re.findall(r'<b>([^<]+)</b>', _wgrid)
_docnames = re.findall(r"^\| \d+ \| ([^|]+?) \|", _today_doc, re.M)
check("today: the widgets are in the order of docs/design/TODAY.md (utility first, the vault at the core)",
      _wnames == _docnames and _wnames[:2] == ["Vault", "Health"], " > ".join(_wnames))
_home = _appt[_appt.index('<section id="pane-home">'):_appt.index('<div class="homerail">')]
_pos = [_home.index(m) for m in ('id="seniorui"', 'class="homehero"', 'id="frslot"', 'id="widgets"', 'id="btn-ecard"', 'class="quickadd"', 'id="more"')]
check("today: an elder's SOS and big buttons first, the family's name and status, a new family's checklist, the four tiles, the emergency card, only then the add buttons, then More",
      _pos == sorted(_pos), str(_pos))
_above_more = _home[:_home.index('id="more"')]
check("today: five things and no more - four tiles and the emergency card (the family review: track 5, not 50)",
      len(_wnames) == 4 and _above_more.count('class="widget"') == 4 and 'id="btn-ecard"' in _above_more)
check("today: everything else is kept, one tap away under More",
      all(x in _home[_home.index('id="more"'):] for x in ('data-goto="chat"', 'data-sec="plans"', 'data-goto="ekta"', 'data-sec="muhurat"', 'data-sec="pay"', 'data-sec="games"', 'id="coincard"')))
# Changed Nov 2026 (being heard): the mood question is back, but as one
# quiet card that is PRIVATE by default. The old public version (everyone's
# answer on the feed, a rotating food or weather question) stays gone.
check("today: no public food or mood question; the mood card is one private card below the alerts, not a sixth tile",
      'id="pulsecard"' not in _appt and "renderPulse" not in _appt and 'id="pu-pick"' not in _appt
      and _appt.count('id="hd-today"') == 1 and _appt.index('id="hd-today"') < _appt.index('id="widgets"'))
_circ = (API_DIR / "circle.mjs").read_text(encoding="utf-8")
_rels = re.findall(r"'([a-z-]+)'", re.search(r"const RELATIONS = \[([^\]]*)\]", _circ).group(1))
for _pick in ("c-role", "j-role", "e-role"):
    _box = re.search(r'id="' + _pick + r'">(.*?)</div>', _appt, re.S).group(1)
    _roles = re.findall(r'data-role="([a-z-]+)"', _box)
    check("roles: every choice in " + _pick + " is one the server keeps, Friend included",
          "friend" in _roles and set(_roles) <= set(_rels) and set(_rels) <= set(_roles), ",".join(_roles))
check("roles: the in-laws and grandchildren are roles too, and a nuclear family is not offered them",
      all(r in _rels for r in ("daughter-in-law", "son-in-law", "grandson", "granddaughter"))
      and "#createcard.nuclear .jointonly{display:none}" in _appt
      and all('data-role="' + r + '" class="jointonly"' in _appt for r in ("daughter-in-law", "son-in-law", "grandson", "granddaughter")))
check("tree: a new family is asked joint or nuclear first, and the server keeps the answer",
      'id="c-ftype"' in _appt and "familyType: newKind === 'family' ? newFamilyType : null" in _appt
      and "FAMILY_TYPES.includes(req.body.familyType)" in _circ)
check("tree: anyone in the family can place anyone; the server checks they are in this family and refuses what cannot be true",
      "['place', 'unplace', 'add_person', 'remove_person'].includes(action)" in _circ and "ownedMember(sql, circle.id, memberId, tokenOf(req)" in _circ and "placement(by, targetId, place, ofId)" in _circ
      and "plan.error" in _circ)
check("tree: each person's label is worked out for whoever is looking",
      "kinLabel(by, g.me.id, m.id)" in (API_DIR / "events.mjs").read_text(encoding="utf-8") and "if (m && m.kin && m.kin !== 'You') return m.kin;" in _appt)
check("tree: a mistake is undone one link at a time, so fixing a wife never cuts off the children",
      "if (link === 'spouse')" in _circ and "if (link === 'parent')" in _circ and 'data-unlink="spouse"' in _appt and 'data-unlink="parent"' in _appt)
check("tree: family who are not on Parwah (Dadi without a phone, someone who has passed away) can be added, and are never given a task or a chat",
      "action === 'add_person'" in _circ and "user_id is not null as on_app" in (API_DIR / "events.mjs").read_text(encoding="utf-8")
      and "function onApp(m)" in _appt and "remove_person" in _appt)
check("tree: the form starts on nothing chosen and says the sentence back before saving",
      "'<option value=\"\">Choose…</option>'" in _appt and "$('tr-say').textContent" in _appt)
_vapi = (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8")
check("vault: a paper can be asked for inside Parwah, by kind so nothing is revealed, and answered with one tap",
      "body.action === 'request'" in _vapi and "body.action === 'answer'" in _vapi and "create table if not exists vault_requests" in _vapi
      and 'id="vd-requests"' in _appt and 'data-vaskk' in _appt and 'id="vdd-ask"' in _appt)
check("vault: Download is a real, named download, not a pop-up blocked on phones",
      "a.download = f.name" in _appt and "window.open(url, '_blank')" not in _appt)
check("vault: whoever added a paper about someone else is shown to them and can be taken back",
      "uploader_access" in _vapi and "set uploader_access = false" in _vapi and "added it, so can open and download it" in _appt)
check("vault: can-open is reading, not rewriting; a blank number keeps the last 4; nobody verifies their own upload",
      "Only the person it belongs to, or whoever added it, can change it" in _vapi and "keepNum ? d0.last4 : last4" in _vapi
      and "if (found.doc.by_member === me.id)\n      return res.status(400)" in _vapi)
check("people: a profile and a person's page lead to their documents",
      'id="mp-docs"' in _appt and 'id="pp-docs"' in _appt and "function openVaultFor(mid)" in _appt and "data-vdocgo" in _appt)
check("emergency card: scrolls when taller than the screen; vital facts large; 112 and the first contact one tap away; cleared on sign-out",
      ".msheet{position:fixed;inset:0;background:rgba(24,38,34,.55);z-index:var(--z-sheet);display:flex;align-items:flex-start;justify-content:center;padding:var(--space-20);overflow-y:auto" in _appt
      and 'class="ec-vital"' in _appt and "a.amb" in _appt and "localStorage.removeItem('parwah-ecard')" in _appt)
check("memory: an emergency contact can be recorded; privacy is never a box an edit ignores; no chip says undefined",
      '<option value="emergency">' in _appt and "$('b-private-l').hidden = true" in _appt and "local: 'Someone near them'" in _appt)
check("payments: ask first has an answer, and the monthly limit holds",
      "body.action === 'approve' || body.action === 'decline'" in _vapi and "limit for this month" in _vapi and "data-vpyes" in _appt)
_auth = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
check("sign-in: typing a number never reveals whose it is before the PIN",
      "needPin: true, name:" not in _auth and "setPin: true, name:" not in _auth and "'. Type your PIN or password.'" not in _appt)
check("joining: an invite opened while signed in opens the join card; signed out, the entry says you were invited",
      "function joinInvite()" in _appt and 'id="ob-invite"' in _appt and "pendCode" in _appt)
check("onboarding: every step is a place Back returns to, and the pitch is on the sign-in screen only",
      "history.pushState({ ob: sub }" in _appt and 'id="c-back"' in _appt and "var pitch = which === 'auth';" in _appt)
check("elders: big text is a display setting anyone can switch on; being looked after brings the three buttons",
      "function applyBig()" in _appt and 'id="ap-big"' in _appt and "I am an elder the family looks after" in _appt
      and "html:has(body.senior){font-size:112.5%}" in _appt)
check("elders: medicines and check-ins earn no coins; Medicines taken keeps its time for the day",
      "if (type === 'checkin' || type === 'pill') await award" not in (API_DIR / "events.mjs").read_text(encoding="utf-8")
      and "function pillKey()" in _appt and "Well done!" not in _appt)
check("confirmations: SOS, sign out and leave ask in Parwah's own sheet with big answers",
      'id="asksheet"' in _appt and "askSheet('Sign out on this phone?'" in _appt
      # SOS asks with its own 5-second countdown and a big Cancel instead.
      and 'id="ss-cancel"' in _appt and "SOS_COUNT = 5" in _appt)
check("profile: You first with Edit under it; AI keys under Advanced; leaving and signing out last; nothing coming soon",
      _appt.index('<h3>You</h3>') < _appt.index('id="plancard"') and "details class=\"card advanced\"" in _appt
      and "Hindi toggle coming soon" not in _appt and "Parwah Plus (coming soon)" not in _appt)
check("bell: only what needs you, never your own actions or chat, rows as buttons, no log lines",
      "function notifWanted(e)" in _appt and "'Type: ' + e.type" not in _appt and '<button type="button" class="nrow' in _appt)
check("invites: the code is kept until the person is in that family, and a reload while waiting comes back to waiting",
      "function inviteDone()" in _appt and "sessionStorage.setItem('parwah-join-wait', code)" in _appt and "if (pendingJoin && inviteMember(circles)) return;" in _appt
      and "try { sessionStorage.removeItem('parwah-join'); } catch (e) {}\n        if (j.pending)" not in _appt)
check("tree: the he or she for the other person is asked before Add is disabled, and cleared when that person changes",
      -1 < _appt.find("if (!$('tr-ofg-wrap').hidden && !ofg) { say(") < _appt.find("btn.disabled = true;\n    var body = { action: isNew ? 'add_person'") and "if (of !== trOfShown) {" in _appt)
check("names: one name per place on tiles, tabs, menu and screens, and family not circle in the copy",
      '<b>To do</b>' in _appt and '<b>Health &amp; contacts</b>' in _appt
      and "✅ To do</button>" in _appt and "← Family</button>" in _appt
      and "✅ Things to do" not in _appt and "<b>Family memory</b>" not in _appt
      and "← People" not in _appt and "Create the circle" not in _appt
      and "Your circle's helper" not in _appt)
# "Circle" is the data model's word (table circles, kind family or group).
# A person reads "family", or "group" when the space is one. Tags go
# whole, so ids, classes and the SVG <circle> are not copy.
_seen = re.sub(r"<[^>]*>", " ", re.sub(r"<!--.*?-->", " ", markup_only(_appt), flags=re.S))
check("words: the app's visible markup says family or group, never circle",
      not re.search(r"\bcircle\b", _seen, re.I),
      ", ".join(sorted(set(" ".join(m.group(0).split()) for m in re.finditer(r"\S*\s*\S*\s*\bcircle\b\s*\S*\s*\S*", _seen, re.I))))[:200])
check("words: feed rows that say 'asked the circle' and the newer 'asked the family' or 'group' all open To do",
      _appt.count("/asked the (circle|family|group)|is on it|finished/i") == 2 and "asked the circle|" not in _appt)
_tsk = (API_DIR / "_tasks.mjs").read_text(encoding="utf-8")
check("to do: a time already gone means tomorrow at that clock time (not 24 hours on), and a task written down after its time wakes nobody",
      "nx.setDate(nx.getDate() + 1); at = new Date(localDay(nx) + 'T' + t)" in _appt and "at.getTime() + 86400000" not in _appt and "${dueAt && dueAt.getTime() < Date.now() ? dueAt : null}" in _tsk)
check("to do: asked but not yet agreed shows one decision; late shows Set a new time and a call",
      "var waitingYes = q.status === 'assigned' && owner;" in _appt and "'Set a new time', 'go'" in _appt and "about_member = ${aboutId}" in _tsk)
check("suggested: a gap is filled now, and any suggestion can be waved away",
      "data-sfill=" in _appt and "data-snot=" in _appt)
check("people: who is waiting, then the family itself, how ready they are, where everyone is, and the tree last with its form folded",
      _appt.index('id="joinreq-card"') < _appt.index('id="famcard"') < _appt.index('id="prepcard"') < _appt.index('id="loc-card"') < _appt.index('id="treecard"')
      and '<details class="treeadd" id="tree-more">' in _appt
      and "var looked = prepCache.filter(" in _appt)
check("people: the profile is a dialog with Call first and only the family word for a person",
      'id="msheet" hidden role="dialog"' in _appt and "' · senior mode'" not in _appt and "function mpClose()" in _appt)
check("staying current: an open or installed Parwah moves to a new version when it comes back to the screen, and the page is never served from the browser cache",
      "function checkUpdate()" in _appt and 'id="updbar"' in _appt
      and "fetch(url.href, { cache: 'no-store'" in (REPO / "site" / "public" / "sw.js").read_text(encoding="utf-8"))
_ekt = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("ekta: anyone in danger is answered first, in fixed words, free - before coins, keys or a model",
      -1 < _ekt.find("asked === 'emergency' || asked === 'crisis'") < _ekt.find("await spend(sql, circle.id, me.id, 'ekta')")
      and "function ektaUrgent(said)" in _appt and 'href="tel:112"' in _appt and "if (j.emergency || j.urgentToo) ektaUrgent(v);" in _appt)
# Ekta: when a turn fails after something was already done (a reminder
# saved), the answer refreshes the screen rather than hiding it.
_ek = (REPO / "api/ekta.mjs").read_text(encoding="utf-8")
check("ekta: a failed turn that names an emergency still refreshes what was already done",
      "if (isUrgent) return answer({" in _ek and "actions: [{ tool: 'refresh' }]" in _ek and "please check before asking again" in _ek)
check("ekta: the scam check, records and medicine questions are never charged; a family word finds the one person saved with it",
      "if (['scam', 'memory', 'summary', 'health'].includes(asked)) {" in _ekt and "localTurn(sql, circle, me, history, 'records')" in _ekt
      and _ekt.find("localTurn(sql, circle, me, history, 'records')") < _ekt.find("await spend(sql, circle.id, me.id, 'ekta')")
      and "kinIsAsked(text, members)" in _ekt and "renderWhoIsIt(names)" in _ekt and "renderWhoIsVisit(" in _ekt and "(e.about === subject || !e.about)" in _ekt)
check("ekta: out of coins still answers what was always free, and says how anyone can earn more",
      "Reading back your records, the scam check and anything urgent stay free." in _ekt and "EARN.checkin" not in _ekt
      and _ekt.find("asked === 'emergency' || asked === 'crisis'") < _ekt.rfind("await providerKeys(sql, circle.id)") and "ektaOffline(j.records ?" in _appt)
check("ekta: the screen says what she does, that she gives no medical advice and what a question costs; chips point at real things",
      "I never give medical advice. A question uses 2 coins" in _appt and "Daily check-in reminder" not in _appt and 'id="evoice" aria-pressed="true" aria-label="Read replies aloud"' in _appt)
check("ekta: coins are earned inside the family, and the same screen says nothing is charged",
      "Nothing is charged, and coins are not for sale." in _appt
      and "Nothing is charged. Coins are earned inside the family, not bought." in _appt)
check("today: a new family is asked to fill the emergency card from what is actually saved",
      "function ecardReady()" in _appt and "Fill the emergency card" in _appt
      and "e.category === 'emergency'" in _appt and "renderFirstRun();" in _appt)
check("muhurat: no health advice in a Rog window, and care never waits for a muhurat",
      "health matters" not in _appt and "Medicines, doctor visits and emergencies never wait for a muhurat." in _appt
      and "health matters" not in (API_DIR / "_panchang.mjs").read_text(encoding="utf-8"))
_swsrc = (REPO / "site" / "public" / "sw.js").read_text(encoding="utf-8")
check("staying current: a window on a copy from before v41 is moved by the new service worker (started, not awaited), and one opened offline moves once back online",
      "c.navigate(c.url)" in _swsrc and "return Promise.all(list.map(function (c) { return 'navigate' in c ? c.navigate" not in _swsrc
      and "+m[1] < SELF_UPDATING" in _swsrc and "if (appLost) { appLost = false; moveToNew(); }" in _appt)
check("staying current: the worker leaves other sites alone, hands redirects back to the browser, and stays alive until windows are moved",
      "if (url.origin !== location.origin) return;" in _swsrc and "redirect: 'manual'" in _swsrc
      and "return self.clients.matchAll({ type: 'window' })" in _swsrc and "var SELF_UPDATING = 42;" in _swsrc and "'parwah-app-v42'" in _swsrc)
check("staying current: unsaved typing holds back a reload even after focus moves; later checks wait for the first",
      "t.__typed = true" in _appt and "appFirst.then(appVersion)" in _appt)
check("joining: a declined request ends the waiting, and a request to join shows in the bell",
      "action: 'join_status'" in _appt and "if (action === 'join_status')" in (API_DIR / "circle.mjs").read_text(encoding="utf-8")
      and "/has asked to join/i.test(t)" in _appt)
_gm = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("games: a finished game stays readable for a day, with the result, Play again and How to play",
      "status = 'done' and ended_at > now() - interval '1 day'" in _gm and 'id="g-again"' in _appt and "var GRULES = {" in _appt and 'id="g-result"' in _appt)
check("games: only the people picked play, and nobody can hold a game up (leave, or let Parwah play after 12 hours)",
      "Pick who is playing with you" in _gm and "body.action === 'away'" in _gm and "AWAY_AFTER_MS = 12 * 3600 * 1000" in _gm and 'data-for="snakes"' in _appt)
check("the board: the paper stays white; the eraser erases; undo; a wipe asks",
      "#dboard{width:100%;aspect-ratio:4/3;background:var(--card-face);" in _appt
      and "'destination-out'" in _appt and 'id="d-undo"' in _appt and "Wipe the whole board?" in _appt)
check("create: joint or nuclear is asked first, with no answer chosen for them",
      "var newFamilyType = null;" in _appt and _appt.index('id="c-ftype"') < _appt.index('id="c-circle"') < _appt.index('id="c-name"'))
check("roles: a new group asks for your role in the group, and starts on Friend",
      "'Who are you in this ' + newKind + '?'" in _appt and "newKind === 'group' ? 'friend' : 'family'" in _appt)
_loc = (API_DIR / "_locationapi.mjs").read_text(encoding="utf-8")
# "Ask to share" names another person, and only pushes them a request: it
# never writes anyone's sharing. Nothing else in the file names anyone else.
_ask = _loc[_loc.index("if (action === 'ask')"):_loc.index("if (action === 'stop')")]
check("location: only the person turns it on; there is no action to share for someone else",
      "requireMember(sql, code, memberId, tokenOf(req))" in _loc and "values (${circle.id}, ${me.id}, true" in _loc
      and "otherId" not in _loc and "targetId" not in _loc.replace(_ask, "")
      and "insert into location_shares" not in _ask and "update location_shares" not in _ask)
check("location: stopping deletes the position, not just hides it",
      "set enabled = false, lat = null, lng = null, accuracy = null" in _loc)
check("location: area only is rounded on the server, so an exact spot is never stored",
      "shareable(pos, precision)" in _loc and "body.precision === 'area' && lat !== null" in _loc)
check("location: sharing is per family or group, and only its members can look",
      "where s.circle_id = ${circle.id} and s.enabled and s.lat is not null" in _loc)
check("location: the app says who can see it and that stopping deletes it",
      "Only people in it can see it, you can stop any time, and stopping deletes it." in _appt)
_head = _appt[:_appt.index("<body")]
_man = (REPO / "site/public/manifest.webmanifest").read_text(encoding="utf-8")
check("brand: Parwah is tagged as the family superapp (title, meta, share cards, manifest, schema, screens)",
      "<title>Parwah - the family superapp</title>" in _head and 'content="Parwah - the family superapp"' in _head
      and "family superapp" in _man and '"categories"' in _man and '"SoftwareApplication"' in _head
      and 'class="eyebrow superapp">The family superapp<' in _appt and 'class="side-tag">family superapp<' in _appt)
check("dls: the design system, checklist and review are written down",
      all((REPO / f).exists() for f in ("docs/design/DESIGN_SYSTEM.md", "docs/design/CHECKLIST.md", "docs/design/REVIEWS.md")))
check("dls: every pull request carries the design checklist",
      (REPO / ".github/pull_request_template.md").exists()
      and "Design sanity" in (REPO / ".github/pull_request_template.md").read_text(encoding="utf-8"))

_light = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);",
                         _css[_css.index(":root{"):_css.index("}", _css.index(":root{"))]))
_dark = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", _css[_css.index(':root[data-theme="dark"]{'):_dark_end]))
_notype = {"--tabs-h", "--side-w", "--dock-h", "--disp", "--body", "--dev", "color-scheme"}
# Spacing, type, radius, layer, motion and tap tokens are the same in both
# themes by design; only colours need a dark value.
_notype |= {t for t in _light if re.match(r"--(space|fs|radius|z|motion|tap|avatar)-", t)}
_missing = sorted(t for t in _light if t not in _notype and t not in _dark)
check(f"theme: every colour token has a dark value ({len(_dark)} of {len(_light) - len(_notype)})",
      not _missing, ", ".join(_missing[:6]))

# The automatic case and the chosen-by-hand case must not drift apart.
_auto = _css[_css.index('@media(prefers-color-scheme:dark)'):]
_auto = dict(re.findall(r"(--[a-z0-9-]+):\s*([^;]+);", _auto[:_auto.index("}\n}")]))
# Same VALUES and the same SET: a token dropped from one block is exactly the
# drift this is here to catch, and comparing only the overlap misses it.
_drift = sorted(t for t in _dark if t in _auto and _auto[t].strip() != _dark[t].strip())
_drift += sorted("missing from automatic: " + t for t in _dark if t not in _auto)
_drift += sorted("missing from chosen: " + t for t in _auto if t not in _dark)
check("theme: automatic dark and chosen dark are the same palette",
      not _drift, "; ".join(_drift[:6]))

check("theme: three states, not two, and the device is one of them",
      'data-theme-set="auto"' in _appt and 'data-theme-set="light"' in _appt
      and 'data-theme-set="dark"' in _appt and "prefers-color-scheme: dark" in _appt)
# A script at the end of body draws the app light and repaints it dark.
check("theme: the choice is applied before the first paint",
      _appt.index("localStorage.getItem('parwah-theme')") < _appt.index("</head>")
      and "before the first paint" in _appt)
check("theme: the browser's own chrome is told too, since CSS cannot reach it",
      'meta[name="theme-color"]' in _appt and "#0B0710" in _appt)
check("theme: on Automatic it follows the device as it changes, not at next reload",
      "addEventListener('change'" in _appt and "themePref() === 'auto'" in _appt)
# Marigold is a light amber; white on it measures 2.17, which is why every
# button in this app puts --dusk on it instead.
_amber = [l for l in _css.splitlines()
          if "var(--marigold)" in l and "color:var(--on-accent)" in l]
check("theme: nothing puts white text on the amber", not _amber, "; ".join(_amber)[:110])
# --dim is muted text on the DARK panels. On a light card it measured 1.6:1
# (Codex review, PR #7), so muted text on light cards wears --dim-day. No
# colour reads 4.5:1 on white and on jamun at once, which is why it is two tokens.
_ondim = [sel for sel in (".rdgap em{", ".frstep small{", ".ec-row.none span{")
          if "var(--dim)" in _css[_css.index(sel):_css.index("}", _css.index(sel))]]
_ondim += ["inline family label"] * _appt.count('<em style="font-style:normal;color:var(--dim)">')
check("theme: muted text on light cards uses --dim-day, not the dark-panel --dim",
      not _ondim and "--dim-day:" in _css, ", ".join(_ondim))

# The Mela gradient is for ordinary actions. A button that also wears a
# status class (red alert, green ok) must keep that colour: the Emergency card
# button went festive orange because the gradient rule out-specified
# .ecard-btn (Codex review, PR #7). Every status class that shares an element
# with .cbtn or .go has to be excluded from the gradient rule by name.
_stat = set()
for _m in re.finditer(r"([^{}]+)\{([^}]*)\}", _css):
    if re.search(r"background:var\(--(alert|ok|sindoor|tint-bad|tint-ok)\)", _m.group(2)):
        _stat.update(re.findall(r"\.([a-zA-Z][\w-]*)", _m.group(1)))
_stat -= {"cbtn", "go", "ghost", "no"}
_grad_rule = [l for l in _css.splitlines() if "background:var(--grad)" in l and ".cbtn" in l]
_mixed = set()
for _cl in re.findall(r"""class=["']([^"']*)["']""", _appt):
    _parts = _cl.split()
    if "cbtn" in _parts or "go" in _parts:
        _mixed.update(c for c in _parts if c in _stat)
_unexcluded = sorted(c for c in _mixed if not all(":not(." + c + ")" in l for l in _grad_rule))
check("theme: a status button keeps its status colour under the Mela gradient",
      bool(_grad_rule) and not _unexcluded, ", ".join(_unexcluded))

# ---------- ORDER: by how often a family really uses each thing ----------
# Owner's rule (2026-10-03): every list of features runs in descending order
# of real-life use. Daily several times (Today, Chat), daily (Care), often
# (People, Notifications), sometimes (Ekta, Memory), rarely (Vault, Together,
# The day, Profile). The Today screen's own cards and shortcuts are ranked in
# docs/design/TODAY.md and guarded by the "today:" checks.
_navseg = _appt[_appt.index('<nav class="tabs" id="tabs"'):_appt.index('id="side-groups-head"')]
_nav = re.findall(r'<button data-tab="(\w+)"(?! data-sec)([^>]*)>', _navseg)
# Owner (2026-10-04): Chat, Ask Ekta and Together (Plans & calls, Games,
# Drawing board) sit right under Today, ahead of the records. On a phone,
# Ekta is a tab, New chat is in the top bar, and Together is in the menu.
_want_nav = ["home", "chat", "ekta", "fun", "vault", "memory", "care", "people", "notifs", "day", "profile"]
check("order: the sidebar runs by real-life use",
      [t for t, _ in _nav] == _want_nav, " > ".join(t for t, _ in _nav))
check("order: the phone tab bar is Today, Vault, Ekta, To do, Family - one bar, SOS docked at its left",
      [t for t, a in _nav if "deskonly" not in a] == ["home", "ekta", "vault", "care", "people"]
      and all(x in _appt for x in ('.tabs button[data-tab="home"]{order:1}', '.tabs button[data-tab="vault"]{order:2}',
                                   '.tabs button[data-tab="ekta"]{order:3}', '.tabs button[data-tab="care"]{order:4}',
                                   '.tabs button[data-tab="people"]{order:5}', ".tabs .inner{padding-left:68px}")),
      " > ".join(t for t, a in _nav if "deskonly" not in a))
_drw = _appt[_appt.index('<div class="dhead">'):_appt.index('id="d-groups-wrap"')]
_drw_top = re.findall(r'class="ditem(?: dparent)?" data-(?:tab|grp)="(\w+)"', _drw)
check("order: the menu drawer runs by real-life use",
      _drw_top == _want_nav, " > ".join(_drw_top))
# Owner (2026-10-13): nothing floats on a phone. New chat sits in the top
# bar, SOS is docked in the tab bar, Ekta is a tab - for parents too; that
# none of them cover All is well, Pills or SOS is proved in firstrun.e2e.
check("order: on a parent's phone nothing covers All is well, Pills or SOS",
      "New chat sits in the top bar, SOS" in (REPO / "site/tests/db/firstrun.e2e.dbtest.mjs").read_text(encoding="utf-8"))
# Owner (2026-10-09): "too many options". Each busy form shows what it needs;
# the rest is one tap away under a fold that names what is inside, opens when
# something in it is set or refused (proved in vault.e2e, care.e2e, plans.e2e).
_folds = re.findall(r'<details class="fmore" id="([a-z-]+)">\s*<summary>([^<]*)</summary>', _appt)
check("options: the busy forms fold their extras under More options, each named",
      sorted(f[0] for f in _folds) == ["b-more", "ex-more", "fr-more", "p-more", "r-more", "st-more", "vd-more", "vp-more"]
      and all(f[1].startswith("More options: ") for f in _folds)
      and "for (var d = el.closest('details'); d;" in _appt
      and all(("foldSync('" + f[0] + "')") in _appt for f in _folds))
# Two functions of one name in the app's script: the later one silently
# replaces the first everywhere. It happened (2026-10-09): the SOS helper took
# over the reminder's "stop the chime", so a reminder chimed on after Snooze.
_fnames = re.findall(r"^  function ([A-Za-z0-9_$]+)\(", _appt, re.M)
check("script: no two app functions share a name (a later one replaces the first)",
      len(_fnames) > 100 and len(_fnames) == len(set(_fnames)))
# Find My (owner, 2026-10-04 and 10-09): ring a phone and Lost mode, proved
# in findme.dbtest (rules) and findme.e2e (three real phones).
_findsrc = (REPO / "api/_findme.mjs").read_text(encoding="utf-8")
check("find my: ring a phone and Lost mode, held by the owner's PIN with the sign-in lockout",
      "RING_SECONDS = 120" in _findsrc and "MAX_TRIES" in _findsrc and "lost_session === tokenHash(token)" in _findsrc
      and 'id="ringscreen"' in _appt and 'id="lostscreen"' in _appt and "findSync(j.findme)" in _appt
      and "ring ? 'parwah-ring'" in (REPO / "site/public/sw.js").read_text(encoding="utf-8")
      and (REPO / "site/tests/db/findme.dbtest.mjs").exists() and (REPO / "site/tests/db/findme.e2e.dbtest.mjs").exists())
_testdb = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("ci: every database test is in npm run test:db, so none is skipped in CI",
      all(f.name in _testdb for f in (REPO / "site/tests/db").glob("*.dbtest.mjs")))
# SOS by text, WhatsApp and call (owner, 2026-10-04): dormant until a Twilio
# account is added; proved with a stand-in Twilio in sosdial.dbtest.
_dialsrc = (REPO / "api/_sosdial.mjs").read_text(encoding="utf-8")
check("sos: texts, WhatsApps and calls go out by themselves once Twilio keys are added, once each, never holding up the alarm",
      "dialOut(sql, sosId, contacts" in (REPO / "api/events.mjs").read_text(encoding="utf-8")
      and "on conflict do nothing" in _dialsrc and "DIAL_TIMEOUT_MS" in _dialsrc and "c.on = !!(" in _dialsrc
      and "process.env.TWILIO" not in _appt)
check("phone app: the native Android/iPhone app hides the links to install it",
      "ParwahApp\\/" in _appt and ".native-app #getapp" in _css
      and ('"appendUserAgent": "ParwahApp/' in (REPO / "mobile" / "capacitor.config.json").read_text()
           # Vercel's upload leaves mobile/ out (.vercelignore); CI has it.
           if (REPO / "mobile" / "capacitor.config.json").exists() else True))
check("theme: text on a coloured chip and on a dark panel are separate tokens",
      "--on-accent:" in _css and "--on-dark:" in _css
      and "is how a themed app ends up with invisible buttons" in _css)

# SHARE CARDS. A page with no Open Graph tags is a blank grey rectangle in
# WhatsApp, and worse than that to a machine: tools that build something FROM
# a url - a preview, an ad, a video - read these tags first, and several of
# them reject a page outright when there is nothing to read, reporting it as
# an invalid address rather than an empty one. Every page on this site had
# none.
_BASE = "https://parwah-hq.anchit-tandon.com"
for _p in SITE_PAGES:
    _h = _p.read_text(encoding="utf-8")
    _rel = _p.relative_to(ROOT / "public")
    _missing = [t for t in ("og:title", "og:description", "og:image", "og:url",
                            "twitter:card") if t not in _h]
    check(f"share card: {_rel} has one", not _missing, ", ".join(_missing))
    # The one that is always got wrong. A relative og:image is resolved by
    # nobody: every scraper wants an absolute URL and most simply report no
    # image, which reads as a broken page rather than a missing tag.
    _imgs = re.findall(r'(?:property|name)="(?:og|twitter):image"\s+content="([^"]+)"', _h)
    check(f"share card: {_rel} names its image absolutely",
          bool(_imgs) and all(i.startswith("https://") for i in _imgs),
          ", ".join(i for i in _imgs if not i.startswith("https://")))
    # A card that points at a page that is not this one is worse than none.
    _url = re.findall(r'property="og:url"\s+content="([^"]+)"', _h)
    _want = _BASE + "/" + (str(_rel.parent) + "/" if str(_rel.parent) != "." else "")
    check(f"share card: {_rel} points at itself", _url == [_want],
          f"says {_url} wanted {_want}")
# AN ASSET THE SITE ASKS FOR MUST ACTUALLY SHIP.
# .gitignore blanket-ignores *.png with a single exception for site/public.
# That exception is what makes the share cards work - and it means an image
# put anywhere else is skipped by `git add -A` in silence. It already
# happened once: the two cards imported into merge/ were never committed,
# and they survived only because they were later copied under site/public.
# An image the HTML references but the checkout does not contain is a 404
# in production and a blank card everywhere the page is shared, and the
# build would not say a word about it.
_asset_missing = []
for _p in PAGES:
    _h = _p.read_text(encoding="utf-8")
    _refs = re.findall(r'(?:src|href|content)="([^"]+\.(?:png|jpg|jpeg|webp|svg|ico))"', _h)
    for _r in _refs:
        if _r.startswith("data:"):
            continue
        if _r.startswith("http"):
            # Only our own host is ours to guarantee.
            if "parwah-hq.anchit-tandon.com" not in _r:
                continue
            _target = ROOT / "public" / _r.split("parwah-hq.anchit-tandon.com/", 1)[1]
        elif _r.startswith("/"):
            _target = ROOT / "public" / _r.split("?")[0].lstrip("/")
        else:
            _target = (_p.parent / _r.split("?")[0]).resolve()
        if not _target.exists():
            _asset_missing.append(f"{_p.relative_to(ROOT)} -> {_r}")
check("assets: every image a page asks for is actually in the build",
      not _asset_missing, "; ".join(_asset_missing[:4]))

# THE INVITE IS THE GROWTH LOOP, and it goes out through WhatsApp: the app
# shares /?join=CODE with wa.me/?text=. WhatsApp builds its preview from
# these tags, and the app page had none, so every invite one family member
# sent another arrived as a blank grey rectangle with a bare link under it.
_app_h = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
for _t in ("og:title", "og:description", "og:image", "twitter:card"):
    check(f"invite preview: the app carries {_t}", _t in _app_h)
check("invite preview: and its image is absolute, like every other one",
      'content="https://parwah-hq.anchit-tandon.com/og-app.png"' in _app_h)
# Meta tags are not tracking. This must not be read as permission to add any.
check("invite preview: the app still carries no analytics",
      "analytics.js" not in _app_h and "googletagmanager" not in _app_h)

# EACH PAGE SHARES ITS OWN CARD. og.png was the products card ("Launching
# soon", "Daily-living essentials", a parked domain), and it was on every
# page, the app's own invite included, so a link to the app arrived in
# WhatsApp promising a shop that is not open. The app pages share the app
# card, the range pages the range card, and each story its own title.
_CARD_OF = {"index.html": "og-app.png", "welcome/index.html": "og-app.png",
            "privacy/index.html": "og-app.png", "terms/index.html": "og-app.png",
            "404.html": "og-app.png", "care/index.html": "og.png",
            "launch/index.html": "og.png", "story/index.html": "og-story.png",
            "story/aisle/index.html": "og-aisle.png", "get/index.html": "og-app.png",
            "press/index.html": "og-app.png"}
for _rel, _card in _CARD_OF.items():
    _h = (ROOT / "public" / _rel).read_text(encoding="utf-8")
    _imgs = re.findall(r'(?:property|name)="(?:og|twitter):image"\s+content="([^"]+)"', _h)
    check(f"share card: {_rel} shares {_card}",
          len(_imgs) == 2 and all(i == _BASE + "/" + _card for i in _imgs), ", ".join(_imgs))

# The image has to exist, at the size every platform crops to.
for _card in ("og.png", "og-app.png", "og-story.png", "og-aisle.png"):
    _f = ROOT / "public" / _card
    check(f"share card: {_card} is actually shipped", _f.exists())
    if _f.exists():
        import struct as _struct
        _b = _f.read_bytes()
        _w, _hh = _struct.unpack(">II", _b[16:24])
        check(f"share card: {_card} is 1200x630", (_w, _hh) == (1200, 630), f"{_w}x{_hh}")

# THE LAUNCH LIST. The rule on this site has always been WhatsApp first and
# no fake forms: a form ships only when a real backend receives it. This is
# that backend. Its logic is unit-tested in site/tests/waitlisttest.mjs; what
# is checked here is the wiring, which that test cannot see.
_wl = (API_DIR / "_waitlist.mjs").read_text(encoding="utf-8")
_auth_src = (API_DIR / "auth.mjs").read_text(encoding="utf-8")
_dbsrc = (API_DIR / "_db.mjs").read_text(encoding="utf-8")

check("waitlist: it costs no serverless slot, it rides the front door",
      not (API_DIR / "waitlist.mjs").exists() and not (API_DIR / "join.mjs").exists()
      and "action === 'waitlist'" in _auth_src)
# A userId in a request body is a claim, not a proof. Renaming a profile
# (and changing its number), marking the tour seen, creating a family and
# joining one each acted as whatever userId the body named. Proved against a
# real database in site/tests/db/authz.dbtest.mjs; this pins the wiring.
check("auth: profile update and the tour flag act only as the signed-in person",
      _auth_src.count("await sessionIs(sql, tokenOf(req), body.userId)") == 2)
check("auth: a family is created or joined only as the signed-in person",
      "(action === 'create' || action === 'join') && !(await sessionIs(sql, tokenOf(req), uid))"
      in (API_DIR / "circle.mjs").read_text(encoding="utf-8"))
check("auth: and the database suite proves it", "authz.dbtest.mjs" in (REPO / "package.json").read_text(encoding="utf-8"))
check("waitlist: the table is created by the schema, not by hand in a console",
      "create table if not exists waitlist" in _dbsrc)
# This one broke a probe for weeks: _health.mjs wrote to waitlist and nothing
# created it, so a fresh database answered "relation waitlist does not exist"
# and the whole database read as broken.
check("waitlist: and the probe that writes to it ensures that schema first",
      "ensureSchema" in (API_DIR / "_health.mjs").read_text(encoding="utf-8"))
check("waitlist: one person is one row, case-insensitively",
      "unique index if not exists waitlist_email" in _dbsrc
      and "lower(email)" in _dbsrc)
# on conflict against a missing index is not a degraded list, it is a broken
# one: Postgres refuses the statement outright.
check("waitlist: a duplicate address cannot leave the site without that index",
      "delete from waitlist w using waitlist k" in _dbsrc)
check("waitlist: and de-duplicating never loses a consent that was given",
      "bool_or(consent)" in _dbsrc)
check("waitlist: nor a phone number or city one copy held",
      "max(phone)" in _dbsrc and "max(city)" in _dbsrc)
# DPDP. The one rule that is not a nicety.
check("waitlist: consent is explicit, and an untick cannot withdraw it silently",
      "consentGiven" in _wl and "waitlist.consent or excluded.consent" in _auth_src)
check("waitlist: the interest field exists, because it is the only question worth asking",
      "INTERESTS" in _wl and "interest = excluded.interest" in _auth_src)
check("waitlist: joining is rate limited per device",
      "rateLimit(sql, 'waitlist'" in _auth_src)
check("waitlist: the reply never reveals whether the address was already there",
      "joinedMessage" in _auth_src
      and "already" not in _wl.split("export function joinedMessage")[1].split("}")[0])
check("waitlist: the gate runs its unit tests before npm install can have run",
      "waitlisttest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("waitlist: and that module stays dependency-free so it can",
      "@neondatabase" not in _wl and "from './_db.mjs'" not in _wl)

# THE SIGNUP, PROOF AND PRIVACY WORK (portfolio review, 2026-10-20). The form
# stores a real entry, a bot cannot stuff it, a yes is kept with its time,
# and the numbers on the home page are counted or plainly marked as samples.
_launch = (ROOT / "public/launch/index.html").read_text(encoding="utf-8")
_form = _launch[_launch.find('<form class="wl-form"'):_launch.find("</form>")]
_wl_branch = _auth_src[_auth_src.find("action === 'waitlist'"):_auth_src.find("action === 'enter'")]
check("signup: the form carries a honeypot no person can see or reach",
      'name="pw_extra"' in _form and 'class="wl-hp" aria-hidden="true"' in _form
      and 'tabindex="-1"' in _form and ".wl-hp{position:absolute;left:-10000px" in _launch)
check("signup: and a filled honeypot is answered like a person but never stored",
      "isBot(body)" in _wl_branch and _wl_branch.find("isBot(body)") < _wl_branch.find("insert into waitlist")
      and "HONEYPOT = 'pw_extra'" in _wl)
check("signup: the consent box is required and starts unticked",
      re.search(r'<input type="checkbox" id="wl-consent" name="consent" required>', _form) is not None
      and "checked>" not in _form.split('id="wl-consent"')[1].split(">")[0] + ">")
check("signup: the stored row keeps when consent was given, and the first yes is the one kept",
      "add column if not exists consent_at timestamptz" in _dbsrc
      and "case when ${row.consent} then now() end" in _wl_branch
      and "else coalesce(waitlist.consent_at, excluded.consent_at) end" in _wl_branch)
check("privacy: what the page promises about keeping and deleting is done in code",
      "delete from waitlist where updated_at < now() - interval '24 months'" in _auth_src
      and "delete from rate_limit where bucket = 'waitlist' and window_start < now() - interval '1 day'" in _auth_src
      and _auth_src.count("await purgeWaitlist(sql)") == 2)
check("signup: one join at a time, a second tap does nothing",
      "if(busy)return;" in _launch and "btn.disabled=true;" in _launch)
check("signup: a failure says the person is not on the list yet, and offers WhatsApp",
      _launch.count("not on the list yet") >= 3 and "join on WhatsApp" in _launch)
check("signup: the privacy notice is linked beside the form",
      'href="../privacy/#launch-list"' in _form)
_priv = (ROOT / "public/privacy/index.html").read_text(encoding="utf-8")
_priv_ll = _priv[_priv.find('id="launch-list"'):_priv.find('id="analytics"')]
check("privacy: the launch list says what, why, where, how long, and how to delete",
      all(h in _priv_ll for h in ("What we collect", "Why we collect it", "Where it is kept",
                                   "How long we keep it", "How to have it deleted", "mailto:anchit.tandon@gmail.com",
                                   "at most 24 months", "internet address, for up to one day"))
      and "date and time you gave it" in _priv_ll)
check("privacy: analytics is explained, and loads only after a yes",
      'id="analytics"' in _priv and "Nothing is loaded from Google until you press Allow" in _priv)
_no_priv = [str(q.relative_to(ROOT / "public")) for q in SITE_PAGES
            if 'class="f-links"' in q.read_text(encoding="utf-8")
            and "privacy/" not in q.read_text(encoding="utf-8").split('class="f-links"')[1].split("</nav>")[0]]
check("privacy: every footer that has links links to the privacy page", not _no_priv, ", ".join(_no_priv))
_welcome = (ROOT / "public/welcome/index.html").read_text(encoding="utf-8")
_proof = (ROOT / "public/proof.js").read_text(encoding="utf-8") if (ROOT / "public/proof.js").exists() else ""
check("proof: the home page shows it near the top, before the features",
      0 < _welcome.find('id="proof"') < _welcome.find('id="features"') and "proof.js" in _welcome)
check("proof: every sample figure and quote lives in one file",
      "var SAMPLE = {" in _proof and "var QUOTES = [" in _proof
      and not re.search(r'data-proof="(waitlist|users)">\s*\d', _welcome))
check("proof: a sample is never shown without saying so on the page",
      "Example figures, to be replaced with live numbers." in _proof
      and "Example figures, to be replaced with live numbers." in _welcome
      and "show(SAMPLE, false)" in _proof and "(QUOTES_ARE_EXAMPLES ? NOTE.quotes : '')" in _proof)
check("proof: a live count too small to mean anything is hidden, never replaced by a sample",
      "var MIN_LIVE = " in _proof and "if (live && counts[k] < MIN_LIVE) { tile.hidden = true; return; }" in _proof)
# With small live counts hidden, the section was only three quotes tagged
# Example, under "Who is joining Parwah": that reads as fake social proof.
# It starts hidden and appears only when there is a number to show.
check("proof: example quotes alone are never the whole section; it waits for a number",
      re.search(r'<section[^>]*id="proof"[^>]*\shidden>', _welcome) is not None
      and "root.hidden = shown === 0 && QUOTES_ARE_EXAMPLES;" in _proof)
# ONE STORY ON EVERY PAGE. /welcome/ says the care range is not on sale yet;
# the footer on seven other pages said Parwah "sells daily-living aids", and
# two pages promised a home-safety guide that does not exist.
_say = {str(q.relative_to(ROOT / "public")): q.read_text(encoding="utf-8") for q in SITE_PAGES}
_sells = [k for k, v in _say.items() if re.search(r"\bsells daily-living", v)]
check("copy: no page says the range is on sale while /welcome/ says it is not", not _sells, ", ".join(_sells))
_legal = [m for v in _say.values() for m in re.findall(r'<p class="legal"[^>]*>(.*?)</p>', v, re.S)
          if "not medicines" in m]
check("copy: every footer legal line says the range is being prepared",
      len(_legal) >= 8 and all("is preparing a range of daily-living aids" in m for m in _legal))
_guide = [k for k, v in _say.items() if re.search(r"(?i)home-safety guide|guide to making a parent", v)]
check("copy: no page promises a home-safety guide that does not exist", not _guide, ", ".join(_guide))
_story = _say.get("story/index.html", "")
check("copy: /story/ says what the app does and links to it, and its drop cap is a letter, not a quote mark",
      'href="../welcome/">See what it does</a>' in _story and "Be first in line." in _story
      and 'class="lead rv">"' not in _story)
check("copy: the launch form's example phone is not the real business number",
      'placeholder="e.g. 9873945238"' not in _say.get("launch/index.html", "")
      and "98739 45238" not in _say.get("launch/index.html", ""))
check("proof: one person is a person, not 1 people",
      "LABEL[k][counts[k] === 1 ? 0 : 1]" in _proof and "'person on the Parwah launch list'" in _proof)
check("proof: the counts are read from the real tables, and cached at the edge",
      "req.query.stats === 'proof'" in _auth_src and "from waitlist where consent" in _auth_src
      and "count(*)::int as n from users" in _auth_src and "s-maxage=600" in _auth_src
      and "proofCounts(" in _auth_src)
# Every page a person can land on and share: a title, a description, a share
# image and the one address search engines should file it under. The 404 is
# not a page anyone should share or index, so it is the one exception.
_meta_missing = []
for _p in SITE_PAGES:
    if _p.name == "404.html":
        continue
    _h = _p.read_text(encoding="utf-8")
    for _need, _pat in (("title", r"<title>[^<]{8,}</title>"),
                        ("description", r'<meta name="description" content="[^"]{30,}"'),
                        ("og:image", r'<meta property="og:image" content="https://'),
                        ("canonical", r'<link rel="canonical" href="https://parwah-hq\.anchit-tandon\.com/')):
        if not re.search(_pat, _h):
            _meta_missing.append(f"{_p.relative_to(ROOT / 'public')}: {_need}")
check("meta: every shareable page has a title, description, og:image and canonical",
      not _meta_missing, "; ".join(_meta_missing[:4]))

# RESPONSIVENESS (INP). Vercel flagged the Muhurat widget: 280 ms from tap
# to screen, "event handlers on this element blocked UI updates". Measured
# A/B at 4x CPU throttle: median 228 -> 156 ms, time inside the handler
# 94 -> 11 ms, every other widget unchanged. These are structural guards,
# not timings, because timings flake under CI load and a guard that flakes
# gets deleted.
_app_src = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
def _fn_body(src, sig):
    """The text of one function, or "" when it does not exist. .index()
    raised instead, so an app without the function crashed the suite
    mid-way and hid every check after it rather than failing this one."""
    i = src.find(sig)
    if i < 0:
        return ""
    body = src[i:]
    j = body.find("\n  }\n")
    return body[:j] if j >= 0 else body
_sw = _fn_body(_app_src, "function switchTab(t){")
check("INP: switching tab paints first and fills the screen after",
      "afterPaint(function(){" in _sw and "if (t === 'day') refreshDay();" not in _sw)
check("INP: the deferred fill is dropped if they have already moved on",
      "if (curTab !== t) return;" in _sw)
# The backstop was 120 ms and fired before slow phones painted, putting the
# whole render back in front of the tap.
_ap = _fn_body(_app_src, "function afterPaint(fn){")
check("INP: the deferral cannot fire before the paint it waits for",
      bool(_ap) and "document.hidden" in _ap and "setTimeout(run, 1000)" in _ap
      and "setTimeout(run, 120)" not in _ap)
# toLocaleTimeString(locale, options) builds a new formatter every call:
# 66x slower than reusing one, identical output across 12,000 date/zones.
_dt = _fn_body(_app_src, "function dTime(iso, tz){")
check("INP: the Day screen's times reuse a formatter instead of building one per call",
      "dtf(" in _dt and "toLocaleTimeString" not in _dt)
_ft = _fn_body(_app_src, "function fmtTime(iso){")
check("INP: so does every list row's timestamp",
      "dtf(" in _ft and "toLocaleTimeString" not in _ft and "toLocaleDateString" not in _ft)

# NEVER A RELOAD LOOP. Shipping sign-in tokens put every existing family into
# one: "please sign in" cleared the account but not the circle, the boot went
# straight back into the circle, and the page reloaded ~100 times a second.
# Proved in flow.browser.mjs (349 fetches in 3.5 s before, 2 after); these
# hold the two properties that make it impossible.
_so = _fn_body(_app_src, "function checkSignedOut(j){")
check("signout: being told to sign in clears the circle too, so the boot cannot re-enter it",
      "clearState()" in _so and "clearAuth()" in _so)
check("signout: and it can never reload more than once in a row",
      "parwah-signout-at" in _so and "showStep('auth')" in _so)
check("signout: a returning family is told why, not dropped on a bare login",
      'id="au-why"' in _app_src and "parwah-why-signin" in _app_src)

# ---------- OWNER ROUND 2026-10-04 ----------
# No Hindi names in the app: the brand mark, Ekta's header, the games and the
# day's sections all read in English. (Ekta and Parwah are names, and stay.)
_devanagari = [l.strip()[:60] for l in _app_src.split("\n") if re.search("[\u0900-\u097F]", l)]
check("words: no Devanagari anywhere in the app", not _devanagari, " | ".join(_devanagari[:3]))
# The games go by the names families know them by (the owner's call):
# Antakshari and Vyapar (the owner's call, 2026-10-30), explained in English on their cards.
check("words: the games go by their proper names",
      all(w not in _app_src for w in ("Saanp Seedhi", ">Bhabhi", "Monopoly 🏠", "Song Chain", "Business 🏠"))
      and "Snakes &amp; Ladders" in _app_src and "<h3>Antakshari 🎤</h3>" in _app_src and "<h3>Vyapar 🏠" in _app_src
      and "starts with the last letter" in _app_src)
check("words: the day's sections are Good times and Horoscope",
      '>Good times</button>' in _app_src and '>Horoscope</button>' in _app_src and '>Rashifal</button>' not in _app_src)
# New chat is in the top bar on every screen but Chat's own; Ekta is a tab.
_sw = _fn_body(_app_src, "function switchTab(")
check("chat: the New chat button is in the top bar, everywhere except Chat",
      "$('chat-fab').hidden = !inApp || t === 'chat';" in _sw
      and _app_src.index('id="chat-fab"') > _app_src.index('class="bar-actions"')
      and _app_src.index('id="chat-fab"') < _app_src.index('id="bell"')
      and "wideScreen()" not in _app_src)
check("chat: on a laptop Chat and Ekta live in the sidebar, not as floats",
      "body.inapp #chat-fab{display:none!important}" in _app_src
      and "wideScreen()" not in _app_src)
check("sos: on a laptop the red button sits in the sidebar, not over the page",
      "body.inapp #sos-fab{position:static" in _app_src and 'class="side-foot"' in _app_src)
# To do: a task done somewhere in Parwah takes you there, and doing it there
# finishes it.
check("todo: a task that is done somewhere in Parwah has a button that goes there",
      "function taskGo(q)" in _app_src and "taskGoButton(q, 'cbtn go-now')" in _app_src)
check("todo: recording a missing fact finishes its Record task",
      "gapTitle(who[0].name, gap.label)" in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and "action: 'task_done'" in (API_DIR / "book.mjs").read_text(encoding="utf-8"))
# Basic checks: one rule each, on the server and mirrored in the app.
_val = (API_DIR / "_valid.mjs").read_text(encoding="utf-8")
check("valid: the rules are dependency-free and unit-tested by the gate",
      "import" not in _val and "validtest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("valid: names are checked wherever a person or family is named, on the server",
      "nameError(name)" in (API_DIR / "circle.mjs").read_text(encoding="utf-8")
      and "nameError(pn)" in (API_DIR / "circle.mjs").read_text(encoding="utf-8")
      and "nameError(name, 'name')" in (API_DIR / "auth.mjs").read_text(encoding="utf-8"))
check("valid: a date of birth in the future is refused, not saved as nothing",
      "dobError(d," in (API_DIR / "circle.mjs").read_text(encoding="utf-8"))
check("valid: spending caps are whole rupees above zero",
      "amountError(body.perTxnCap" in (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8"))
check("valid: and the app checks the same, beside the box that is wrong",
      all(x in _app_src for x in ("fieldErr('c-name'", "fieldErr('j-name'", "fieldErr('e-name'", "fieldErr('e-dob'",
                                    "fieldErr('vp-cap'", "fieldErr('vd-expires'", "fieldErr('p-count'", "fieldErr('call-link'"))
      and "nameCheck($('au-name').value" in _app_src and ".fielderr{" in _app_src)

# ---------- SOS (owner, 2026-10-04) ----------
# A red button on every screen; a 5-second countdown with Cancel; then the
# alert to every phone as an emergency, the message in the family chat,
# location on and exact until SOMEONE ELSE marks the person safe, a short
# recording, and one-tap calls and messages. Proved end to end by
# site/tests/db/sos.e2e.dbtest.mjs.
_sosmod = (API_DIR / "_sos.mjs").read_text(encoding="utf-8")
_evt = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_locapi = (API_DIR / "_locationapi.mjs").read_text(encoding="utf-8")
check("sos: the red button is on every screen, docked in the one bottom bar, never hidden",
      'id="sos-fab"' in _app_src and "$('sos-fab').hidden = !inApp;" in _app_src
      and "#sos-fab{position:fixed" in _app_src and "width:56px;height:56px;min-height:56px" in _app_src)
check("sos: a countdown with Cancel stands in for the question, and every SOS button uses it",
      "SOS_COUNT = 5" in _app_src and "$('btn-sos').addEventListener('click', function(){ sosStart(''); });" in _app_src
      and "sosStart(said)" in _app_src)
check("sos: sent as an emergency push (high urgency, stays on screen, long buzz)",
      "urgency: 'high'" in (API_DIR / "_push.mjs").read_text(encoding="utf-8")
      and "requireInteraction: urgent" in (REPO / "site/public/sw.js").read_text(encoding="utf-8"))
check("sos: the message goes in the family chat with a map link",
      "ensureCircleChat(sql, circle.id)" in _evt and "maps.google.com/?q=" in _sosmod)
# Owner (2026-10-10): anyone in the family or group ends an SOS, the person
# who sent it included; until then the location stays held on (sos.e2e).
check("sos: location is held on until the SOS is closed, by the sender or anyone in the family",
      "lockForSos(sql, circle.id, me.id, sosId, pos)" in _evt and "unlockSos(sql, circle.id, row[0].member_id)" in _evt
      and "unlockSos(sql, circle.id, memberId)" in _evt
      and "status(423)" in _locapi and "s.sos_lock is null" in _locapi
      and "othersOnApp(sql, circle.id, memberId)) > 0" not in _evt)
# Owner (2026-10-10): "elements should never get hidden"; owner (2026-10-13):
# one bottom bar, no second dock. SOS is docked inside the tab bar, New chat
# is in the top bar, and the SOS bar pushes the page down. Proved in
# flow.browser at 320 and 390px.
check("layout: one bottom bar on a phone, nothing floats over the page; the SOS bar never covers the header",
      'id="fabdock"' not in _appt and "hasdock" not in _appt and "body.sosup{padding-top:var(--sos-h" in _appt
      and "position:sticky;top:var(--sos-h,0px)" in _appt)
check("sos: a short recording, heard only by the family",
      "sos_media" in _sosmod and "SOS_AUDIO_MAX" in _evt and "and s.circle_id = ${circle.id}" in _evt.split("if (q.sosAudio)")[1][:700])
check("sos: other phones take the whole screen with a siren until someone answers",
      'id="sosalert"' in _app_src and "function sirenStart()" in _app_src and "sosSync(data.sos || [])" in _app_src)
check("sos: one tap to 112, the family, WhatsApp, SMS and email",
      'href="tel:112"' in _app_src and "wa.me/?text=" in _app_src and "'sms:' + nums.join(',')" in _app_src and "mailto:?subject=" in _app_src)
check("sos: the end-to-end suite runs with the database suites",
      "sos.e2e.dbtest.mjs" in (REPO / "package.json").read_text(encoding="utf-8"))

# ---------- Everyday family tools (owner, 2026-10-04) ----------
_tasksrc = (API_DIR / "_tasks.mjs").read_text(encoding="utf-8")
check("reminders: a task can ring at its time or before it, once, and is late only after a grace",
      "export async function sweepReminders" in _tasksrc and "reminded_for is distinct from due_at" in _tasksrc
      and "LATE_GRACE_MIN" in _tasksrc and 'id="r-remind"' in _app_src and 'id="alarmsheet"' in _app_src)
# The GitHub scheduled timer (tick.yml) is gone: its runs came hours late and,
# from 5 Nov 2026, Cloudflare in front of the domain answered GitHub's runners
# 403. The clock is every signed-in poll (runTick), Vercel's daily cron and
# an outside every-minute caller with the CRON_SECRET header.
check("reminders: a timer rings them with every phone closed, and says nothing private",
      not (REPO / ".github/workflows/tick.yml").exists()
      and "req.query.tick !== undefined" in _evt and "rateLimit(sql, 'tick', 'all', 1, 50, { failClosed: true })" in _evt
      and "x-cron-secret" in _evt and any(c.get("path", "").startswith("/api/events?tick") for c in _json.loads((REPO / "vercel.json").read_text(encoding="utf-8")).get("crons", [])))
check("timer: shared cards, festivals and the weekly story question ring from the timer too",
      "sweepBond(sql, c)" in _evt and "storySweep(sql, id)" in _evt and "ensureMemoryBondSchema" in _evt)
check("schema: care tools, plan prices and the horoscope set up their tables through schemaOnce",
      all("schemaOnce(() => " + n + "(sql))" in (API_DIR / f).read_text(encoding="utf-8")
          for f, n in (("_careprep.mjs", "carePrepTables"), ("_planapi.mjs", "planTables"), ("_horoscope.mjs", "horoscopeTables"),
                       ("_bookschema.mjs", "bookTables"), ("_coins.mjs", "coinTables"), ("_pulse.mjs", "pulseTables"))))
check("schema: a deadlock between two first loads is retried like the other races",
      "'40P01'" in (API_DIR / "_db.mjs").read_text(encoding="utf-8"))
check("chat: the day line uses the viewer's own date, not the server's UTC day",
      "fmtDue(localYmd(m.created_at))" in _app_src and "function localYmd(t)" in _app_src)
check("errors: a plain reason with 'at' in it (at least, at 5pm) is shown, only a stack line is hidden",
      r"\bat [\w.$<>]+ \(\S*:\d+" in _app_src and r"\bat \S|" not in _app_src)
check("together: Cook together lists the family's own recipes",
      "window.parwahRasoiList = function()" in _app_src and "window.parwahRasoiList()" in _app_src)
check("together: Today loads the shared cards and polls as well as the family memory (a merge once dropped one)",
      "    ccRefresh();\n    bondRefresh();\n    mbTodayLoad();\n" in _app_src)
_static_ids = re.findall(r'\bid="([^"]+)"', re.sub(r"<script\b.*?</script>", "", _app_src, flags=re.S))
_dup_ids = sorted({i for i in _static_ids if _static_ids.count(i) > 1})
check("app: every id in the page is used once (two merges once shared bondsheet, pl-cancel and g-done)",
      not _dup_ids, ", ".join(_dup_ids))
_notes = (API_DIR / "_notesapi.mjs").read_text(encoding="utf-8")
check("notes: shared lists under To do; a private note is private in the query itself",
      'data-sec="notes"' in _app_src and "(not n.private or n.by_member = ${me.id})" in _notes
      and "if (area === 'notes') return notesApi(req, res);" in (API_DIR / "book.mjs").read_text(encoding="utf-8"))
check("notes: never a card number or a banking secret",
      "function luhn(d)" in _notes and "noteRisk" in _notes)
# Pasand (likes, where I watch, recommendations): proved in pasandtest (the
# rules), pasand.dbtest (the handler on PostgreSQL) and pasand.e2e (two real
# phones). These guard what must not drift: it costs no serverless function,
# the audience and the readers of a recommendation are decided in the query,
# and a password or a sign-in is never kept.
_ps = (API_DIR / "_pasand.mjs").read_text(encoding="utf-8")
_psr = (API_DIR / "_pasandrules.mjs").read_text(encoding="utf-8")
_psg = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("pasand: it rides /api/games?area=pasand in an underscore module, never a new serverless function",
      "import pasandApi from './_pasand.mjs';" in _psg and "if (area === 'pasand') return pasandApi(req, res);" in _psg
      and "var pasandApi = '/api/games?area=pasand';" in _app_src and 'data-sec="pasand"' in _app_src
      and not (API_DIR / "pasand.mjs").exists())
check("pasand: who sees a person's likes and platforms is decided in the query itself, for both",
      _ps.count(""".member_id = ${me.id} or coalesce(p.audience, 'family') = 'family'
           or (p.audience = 'chosen' and ${me.id}::uuid = any(p.chosen)))""") == 2
      and "check (audience in ('family', 'chosen', 'me'))" in _ps)
check("pasand: a recommendation is read only by its sender and its recipients, in the query itself",
      "and (r.by_member = ${me.id} or exists (select 1 from pasand_rec_to t where t.rec_id = r.id and t.member_id = ${me.id}))" in _ps
      and "and t.member_id = ${me.id}\n                          returning t.rec_id" in _ps
      and "and by_member = ${me.id} returning id" in _ps and "primary key (rec_id, member_id)" in _ps)
check("pasand: a password, a sign-in or a link that is not plain https is refused with a reason, never kept",
      "noteRisk(v) || credRisk(v)" in _ps and _ps.count("pasandRisk(") >= 5
      and "export function credRisk(v)" in _psr and "if (u.username || u.password) return NO_PASSWORD;" in _psr
      and "if (u.protocol !== 'https:')" in _psr and "PASAND_MAX.link" in _psr and "link: 300" in _psr
      and not re.search(r"\b(password|passwd|secret|credential)\w*\s+(text|bytea)", _ps))
check("pasand: the screen says no password is asked for, and no account is linked",
      "Tick what you have so the family knows where to watch together. Parwah never asks for your password." in _app_src
      and 'type="password" id="ps-' not in _app_src)
check("pasand: its tables are made through schemaOnce, sending is rate limited, and only recipients are pushed",
      "schemaOnce(() => pasandTables(sql))" in _ps and "rateLimit(sql, 'pasand_rec', me.id, PASAND_MAX.perHour, 3600, { failClosed: true })" in _ps
      and "rateLimit(sql, 'pasand_rec_day', me.id, PASAND_MAX.perDay, 86400, { failClosed: true })" in _ps
      and "pushCircle(sql, circle.id, payload, { only: id })" in _ps
      and "requireMember(sql, code, memberId, tokenOf(req))" in _ps)
check("pasand: Today, the Together tab and a person's page all draw it, and errors go through humanFail",
      'id="ps-today"' in _app_src and 'id="ps-person-card"' in _app_src and "pasandPersonRender(id);" in _app_src
      and "    mbTodayLoad();\n    pasandRefresh();\n" in _app_src
      and "humanFail(j.error, 'That did not work. Try again.')" in _app_src.split("function pasandPost(")[1][:600])
check("pasand: the rules test runs in the gate, and the db and browser tests run in test:db",
      "node site/tests/pasandtest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and all(f in _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
              for f in ("pasand.dbtest.mjs", "pasand.e2e.dbtest.mjs")))
check("events: appointments, functions and trips; reminded an hour before; birthdays from dates of birth",
      "'appointment', 'function', 'trip'" in (API_DIR / "plans.mjs").read_text(encoding="utf-8")
      and "sweepPlanReminders" in _evt and "function bdaysSoon(days)" in _app_src)
check("quick add: one row on Today reaches every add form, after the content, never before it",
      _app_src.count('data-qadd="') == 5 and _app_src.index('class="quickadd"') > _app_src.index('id="btn-ecard"')
      and _app_src.index('class="quickadd"') < _app_src.index('id="more"'))
_geo = (API_DIR / "_geo.mjs").read_text(encoding="utf-8")
check("find my: places with arrive and leave alerts, ask to share, battery",
      "export function placesAt" in _geo and "async function placeNews" in _loc and "action === 'ask'" in _loc
      and "navigator.getBattery" in _app_src)

# ---------- iPhone install profile (owner, 2026-10-24) ----------
# /get installs Parwah on any iPhone through a Web Clip profile: it must open
# the live app full screen with the app's own icon, and match what
# site/make-webclip.py writes.
import plistlib as _plistlib
_prof_path = ROOT / "public" / "install" / "parwah.mobileconfig"
try:
    _prof = _plistlib.loads(_prof_path.read_bytes())
    _clip = _prof["PayloadContent"][0]
except Exception as e:
    _prof, _clip = {}, {"error": str(e)}
check("iphone profile: one full-screen Web Clip of the live app with the app icon",
      _prof.get("PayloadType") == "Configuration"
      and _clip.get("PayloadType") == "com.apple.webClip.managed"
      and _clip.get("URL") == "https://parwah-hq.anchit-tandon.com/"
      and _clip.get("Label") == "Parwah" and _clip.get("FullScreen") is True
      and _clip.get("Icon") == (ROOT / "public" / "apple-touch-icon.png").read_bytes(),
      str({k: v for k, v in _clip.items() if k != "Icon"}))
_vj = _json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8"))
_ph = [h for h in _vj.get("headers", []) if h["source"].endswith(".mobileconfig")]
check("iphone profile: served as a profile, so Safari offers to install it",
      any(x["key"] == "Content-Type" and x["value"] == "application/x-apple-aspen-config" for h in _ph for x in h["headers"]))

# ---------- 10z. The pre-launch repairs (audit of 2026-10-30) ----------
# Each of these was a real dead end or a false statement in the app. The
# journeys are run end to end in site/tests/db/repair.e2e.dbtest.mjs; these
# checks keep the source from drifting back.
_js = re.sub(r"//[^\n]*", "", _app_src)   # comments may name what was removed
check("repairs: a forgotten PIN is shown to the family and answered with reset_approve / reset_deny",
      "data-resetok" in _app_src and "'reset_approve'" in _app_src and "'reset_deny'" in _app_src
      and 'id="pinresets"' in _app_src and 'id="npinresets"' in _app_src and "takeResets(j)" in _app_src)
check("repairs: no browser confirm() or prompt(); the app asks in its own sheet",
      not re.search(r"[^\w.]confirm\(|[^\w.]prompt\(", _js) and "function askText(" in _app_src)
check("repairs: no invented lab numbers after an upload, and the server's biomarker actions",
      "Lal PathLabs" not in _app_src and "'biomarker_save'" in _app_src and "'biomarker_parse'" in _app_src
      and "&person_id=" not in _app_src)
check("repairs: the locator posts locator_add with the server's fields and no Unlock button",
      "action: 'locator_add'" in _app_src and "institutionOrItem:" in _app_src and "data-unlockloc" not in _app_src
      and "MULTI_SIG_VERIFIED" not in _app_src and "j.locators" in _app_src)
check("repairs: medicine stock uses refill_add / refill_mark / refill_snooze and reads inventory",
      all(a in _app_src for a in ("'refill_add'", "'refill_mark'", "'refill_snooze'", "j.inventory", "warning_due", "days_left"))
      and "action: 'refill'," not in _app_src and "action: 'snooze'" not in _app_src)
check("repairs: a voice note becomes a task through task_create, never task_add",
      "action: 'task_create', title: title" in _app_src and "'task_add'" not in _app_src)
check("repairs: the offline emergency card is never overwritten by an empty family",
      "if (!state || !membersCache || !membersCache.length) return;" in _app_src)
check("repairs: the family call room is 16 random bytes and carries no family code",
      "crypto.getRandomValues(rb)" in _app_src and "state.code.toLowerCase() + '-' + Math.random()" not in _app_src)
check("repairs: every button takes the page's font, and plain links the app's link colour",
      "button{font:inherit}" in _app_src and "a:not([class]){color:var(--sindoor)" in _app_src)
check("repairs: the phone that forgot waits for the family with its secret, then chooses a new PIN with it",
      "action: 'reset_status'" in _app_src and "resetSecret: rsCur.secret" in _app_src and "newPin: $('au-pin').value" in _app_src
      and "sessionStorage.setItem('parwah-reset'" in _app_src and "localStorage.setItem('parwah-reset'" not in _app_src
      and "setInterval(function(){ rsPoll(false); }, 10000)" in _app_src and "document.hidden" in _app_src[_app_src.index("function rsPoll("):_app_src.index("function rsPoll(") + 400])
check("repairs: the server's newer replies are read: a voice task's own title and time, a throttled SOS, Ekta's emergency in chat, a horoscope feed that is down",
      "intent.task.title" in _app_src and "voiceDue(intent.task.time" in _app_src and "if (j.throttled)" in _app_src
      and "if (j.ektaEmergency) chatUrgent(v)" in _app_src and "h.feedDown" in _app_src)
check("repairs: the To do filters call the function that exists",
      "renderReminders(" not in _js)

# ---------- 10cc. Care cycle: dose ticks, the hospital screen, after a visit ----------
# The journeys run end to end in site/tests/db/carecycle.e2e.dbtest.mjs and
# against the database in carecycle.dbtest.mjs; these keep the source honest.
_dz = (API_DIR / "_doses.mjs").read_text(encoding="utf-8")
_ad = (API_DIR / "_admission.mjs").read_text(encoding="utf-8")
_vz = (API_DIR / "_visits.mjs").read_text(encoding="utf-8")
_strip = lambda t: re.sub(r"//[^\n]*", "", t)
check("care cycle: doses, the hospital screen and visits ride on existing routes, no new function",
      "area === 'doses'" in (API_DIR / "care.mjs").read_text(encoding="utf-8")
      and "area === 'admission'" in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and "area === 'visit'" in (API_DIR / "plans.mjs").read_text(encoding="utf-8")
      and not any((API_DIR / f).exists() for f in ("doses.mjs", "admission.mjs", "visits.mjs")))
check("care cycle: the nudge and the family alert are each claimed once, inside waking hours",
      "d.nudged_at is null" in _dz and "d.alerted_at is null" in _dz and "update medicine_doses d set nudged_at = now()" in _dz
      and "update medicine_doses d set alerted_at = now()" in _dz and _dz.count("between ${WAKE_FROM} and ${WAKE_TO}") == 2
      and "sweepDoses(sql, circle.id)" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))
check("care cycle: every dose read and the alert respect who may see a private medicine",
      _strip(_dz).count("from book_access ba where ba.entry_id = b.id") >= 4)
check("care cycle: a tick is a record, said in the app's own words",
      "A tick is what was marked, not a check that the medicine was taken." in _app_src
      and "It is a note, not a check." in _app_src)
check("care cycle: no dose advice and no therapeutic words in the new modules",
      not re.search(r"\b(dosage|overdose|double the dose|cure|treat|therapy)\b", _strip(_dz + _ad + _vz), re.I))
check("care cycle: the hospital screen keeps IDs as their last four and quotes no insurer timings",
      "policy_last4 text" in _ad and "claim_last4 text" in _ad and "policy_number" not in _strip(_ad).split("create table if not exists admissions")[1].split(")`;")[0]
      and not re.search(r"IRDAI|turnaround|within \d+ (hours|minutes)", _strip(_ad) + _app_src[_app_src.index('id="admsheet"'):_app_src.index('id="vsheet"')], re.I))
check("care cycle: visit notes are record-only; nothing in that path calls Ekta or a model",
      not re.search(r"anthropic|ekta|_ektalocal", _strip(_vz), re.I)
      and "Parwah and Ekta never read or explain a prescription or a report." in _app_src)
check("care cycle: the old one-a-day button stays, and gives way only when times are set",
      'id="btn-pill"' in _app_src and "pill.hidden = !!slots.length" in _app_src and "'pill'" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))

# ---------- Family tools: nearby helpers, costs, home staff, renewals ----------
# The nearest-person ladder, shared care costs, the home staff register and
# renewal radar (api/_ladder.mjs, _expenses.mjs, _staff.mjs, _renewals.mjs).
# Behaviour is proved against a real database in familytools.dbtest; these
# are the promises that must never quietly change.
_ft = {n: (API_DIR / n).read_text(encoding="utf-8") for n in ("_ladder.mjs", "_expenses.mjs", "_staff.mjs", "_renewals.mjs", "care.mjs", "events.mjs", "circle.mjs", "_sosdial.mjs")}
check("family tools: each lives behind /api/care, never a new function",
      all(f"area === '{a}'" in _ft["care.mjs"] for a in ("ladder", "expenses", "staff", "renewals")))
check("ladder: a nearby person joins only on their own yes, from a link nobody signs in for",
      "consent = 'yes'" in _ft["_ladder.mjs"] and "req.query.consent !== undefined) return consentPage" in _ft["circle.mjs"]
      and "token_hash" in _ft["_ladder.mjs"] and "randomBytes(24)" in _ft["_ladder.mjs"])
check("ladder: the consent page says what is done, what is kept and how to remove it (DPDP)",
      all(t in _ft["_ladder.mjs"] for t in ("What Parwah will do", "What is kept about you", "How to remove it", "Stop and delete my details", "noindex")))
check("ladder: other features read it through ladderFor(sql, circleId, personId)",
      "export async function ladderFor(sql, circleId, personId)" in _ft["_ladder.mjs"])
check("ladder: an unanswered SOS calls rung by rung, claimed once, inside the family's daily cap",
      "ladderEscalate(sql, circle.id, SOS_ESCALATE_MIN)" in _ft["events.mjs"] and "primary key (sos_id, rung)" in _ft["_ladder.mjs"]
      and "DIAL_DAY_MAX" in _ft["_sosdial.mjs"][_ft["_sosdial.mjs"].index("export async function dialLadder"):])
check("ladder: without Twilio the family's SOS alarm shows the helpers with Call buttons",
      "function sosLadder(other)" in _appt and 'id="sa-ladder"' in _appt and "sosLadder(other);" in _appt)
check("costs: a record only - no payment link, no transfer, amounts kept in their own currency",
      not re.search(r"upi://|upi_link|checkout|payment_link", _ft["_expenses.mjs"]) and "EXPENSE_CURS = ['INR', 'USD', 'AED', 'GBP', 'CAD']" in _ft["_expenses.mjs"]
      and "A record only: Parwah never moves money" in _appt)
check("costs: the balance line is neutral words, never blame",
      "' than their share'" in _ft["_expenses.mjs"] and not re.search(r"owes|debt|defaulter", _ft["_expenses.mjs"], re.I))
check("staff: only the last 4 of an ID, and the add form tells the family to tell them (DPDP)",
      "/^[A-Za-z0-9]{4}$/" in _ft["_staff.mjs"] and "Tell them what you record here" in _appt)
check("staff: the month's pay is a sum written out in words",
      "' salary'" in _ft["_staff.mjs"] and "divided by" in _ft["_staff.mjs"] and "p.formula" in _appt)
check("staff: a late arrival alerts once a day, on working days only",
      "primary key (staff_id, day)" in _ft["_staff.mjs"].split("staff_late_alert")[1] and "work_days" in _ft["_staff.mjs"]
      and "sweepStaffLate(sql, circle.id)" in _ft["events.mjs"])
check("staff: respectful words about the people who help",
      not re.search(r"\b(servant|naukar|bai|absconded|no-show)\b", _ft["_staff.mjs"] + _appt[_appt.index('data-sec="staff" hidden'):_appt.index('data-sec="renewals" hidden')], re.I))
check("renewals: 30 and 7 days ahead, each once per expiry date",
      "STAGES = [30, 7]" in _ft["_renewals.mjs"] and "primary key (ref_id, stage, for_date)" in _ft["_renewals.mjs"]
      and "sweepRenewals(sql, circle.id)" in _ft["events.mjs"])
check("renewals: freshness like the family book, and a private vault paper only for who may see it",
      "last_verified_at" in _ft["_renewals.mjs"] and "va.member_id is not null" in _ft["_renewals.mjs"])

# ---------- Family care tools (2026-11-02): quiet day, ask family first,
# the life certificate, the call rota, help with the phone ----------
_fc_api = (API_DIR / "_familycare.mjs").read_text(encoding="utf-8")
_fc_rules = (API_DIR / "_carerules.mjs").read_text(encoding="utf-8")
_fc_ev = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_fc_care = (API_DIR / "care.mjs").read_text(encoding="utf-8")
_fc_js = _app_src[_app_src.index("// ---------- family care tools (api/_familycare.mjs)"):_app_src.index("// Every family-care button, in one place.")]
_fc_html = "".join(_app_src[_app_src.index(a):_app_src.index(b)] for a, b in (
    ('<div class="msheet" id="fcafsheet"', '<!-- A question with two big answers'),
    ('<div id="fcalerts"', '<!-- For an elder'),
    ('<div class="card fccard" id="fcquiet"', '<div class="widgets" id="widgets">')))
check("care tools: they live behind existing routes, never a new serverless function",
      "FC_EVENT_TYPES.includes(type)" in _fc_ev and "FC_CARE_ACTIONS.includes(action)" in _fc_care
      and not (API_DIR / "familycare.mjs").exists())
check("care tools: every write goes through requireMember, and the missed check-in is claimed once by a conditional UPDATE",
      "requireMember(sql, b.code, b.memberId, tokenOf(req))" in _fc_api
      and "quiet_nudged_for is distinct from ${today}::date returning id" in _fc_api
      and "quiet_alerted_for is distinct from ${today}::date returning id" in _fc_api)
check("care tools: the check-in is off until the person says yes on their own screen, and away pauses it",
      "'quiet_answer'" in _fc_api and "checkin_ask" in _fc_api and "away_until" in _fc_api
      and "data-fcqyes" in _fc_js and "It stays off unless you say yes" in _fc_js)
check("care tools: the family alert is calm: a question and a Call button, 30 minutes after a gentle nudge",
      "has not checked in today. Give " in _fc_rules and "QUIET_GRACE_MIN = 30" in _fc_rules and "Sab theek?" in _fc_rules
      and "href=\"tel:' + encodeURIComponent(q.phone)" in _fc_js)
check("care tools: an elder's Today has the two big buttons, after SOS, All is well and Medicines",
      _app_src.index('id="btn-pill"') < _app_src.index('id="btn-askfirst"') < _app_src.index('id="btn-phonehelp"') < _app_src.index('class="homehero"'))
check("elder Today, calmest first (TODAY.md): All is well, then the medicine ticks, then SOS, then the rest; SOS also docked in the tab bar",
      _app_src.index('id="btn-checkin"') < _app_src.index('id="btn-pill"') < _app_src.index('id="dose-elder"') < _app_src.index('id="btn-sos"') < _app_src.index('id="btn-askfirst"')
      and 'id="sos-fab"' in _app_src)
check("care tools: ask family first gives the rules, 1930 and cybercrime.gov.in, and needs a family yes",
      all(x in _fc_html for x in ("Never share an OTP or your UPI PIN", "Police never arrest anyone on a video call",
                                   "Banks never ask for KYC on a phone call", "Hang up and call us", 'href="tel:1930"', 'href="https://cybercrime.gov.in"'))
      and "'askfirst_ack'" in _fc_api and "urgent: true" in _fc_api and "data-fcafack" in _fc_js)
check("care tools: Parwah never claims to spot a scam",
      not re.search(r"\b(detect|detects|detected|we catch|scam[- ]proof|guarantee)", (_fc_html + _fc_js + _fc_rules).lower()))
check("care tools: the safe word is for members only and never in the feed or a push",
      "The word itself never goes in the feed or a push" in _fc_api and "safeWord" in _fc_api)
check("care tools: the life certificate links only to jeevanpramaan.gov.in, and keeps no face scan or Aadhaar number",
      set(re.findall(r"https?://[a-z.]*jeevan[a-z.]*", _app_src)) == {"https://jeevanpramaan.gov.in"}
      and "Only the acknowledgement number is kept" in _fc_js and "looks like an Aadhaar number" in _fc_rules
      and "as announced each year" in _fc_js and "'-10-01'" in _fc_rules and "'-11-30'" in _fc_rules)
check("care tools: a yearly repeat, in the form, the edit sheet and the server",
      "'yearly'" in (API_DIR / "_recur.mjs").read_text(encoding="utf-8") and 'data-rep="yearly"' in _app_src
      and '<option value="yearly">Yearly</option>' in _app_src and "yearly:'every year'" in _app_src)
check("care tools: the call rota says Called, passes on with Skip, and the pulse finds today's person first",
      "'Called ' + about.name" in _fc_api and "'rota_skip'" in _fc_api and "pulseCallNudge(sql, circle.id" in _fc_ev
      and "it is your turn today" in _fc_api)
check("care tools: help with the phone posts to the family chat, one person takes it, and offers the family call",
      "chatSay(sql, circle.id, me.id, img, 'image')" in _fc_api and "'help_claim'" in _fc_api and "askCall()" in _fc_js)
_howto = re.findall(r'<details class="howto">', _app_src)
check(f"care tools: 6 to 8 short how-to cards ({len(_howto)})", 6 <= len(_howto) <= 8)
check("care tools: dignity-first words: never lonely, monitoring, tracking, fall detection or elderly",
      not re.search(r"\b(lonely|loneliness|monitor\w*|surveil\w*|tracking|fall detection|elderly)\b", (_fc_html + _fc_js + _fc_api + _fc_rules).lower()))
check("care tools: the forms ask in the app's own sheets, never confirm() or prompt()",
      "askSheet(" in _fc_js and not re.search(r"[^\w.](confirm|prompt)\(", _fc_js))
# The link between the two: a missed check-in nobody took up (no check-in,
# nobody said "I'm calling") reaches the first nearby helper who said yes.
_sd = (API_DIR / "_sosdial.mjs").read_text(encoding="utf-8")
check("care tools: a missed check-in nobody took up reaches the first helper who said yes, once a day, inside the call cap",
      "ladderFor(sql, circleId, m.id)" in _fc_api and "primary key (person_id, day)" in _fc_api
      and "QUIET_LADDER_MIN = 30" in _fc_rules and "m.acked !== today" in _fc_api and "'quiet_ack'" in _fc_api
      and "sentToday(sql, circleId)) >= DIAL_DAY_MAX" in _sd[_sd.index("export async function dialQuietLadder"):]
      and "data-fcqack" in _fc_js and "ql.called" in _fc_js)
check("care tools: the helper's call for a missed check-in is calm, never an SOS or an emergency",
      not re.search(r"S O S|[Ee]mergency", _sd[_sd.index("export function quietLadderScript"):_sd.index("export async function dialQuietLadder")]))

# ---------- 10g. Launch growth: attribution, install trust, press kit, marketing copy ----------
# ATTRIBUTION WITHOUT A PIXEL. Every WhatsApp button on a public page carries
# a short source code in the words it pre-fills ("Hi Parwah (LI1) - ..."),
# so the first message says which post or ad brought the person. attrib.js
# swaps in the first-touch code from ?ref= / ?utm_source=&utm_campaign=; the
# code written into the page is that page's own, so it works without script.
_attrib = (ROOT / "public" / "attrib.js").read_text(encoding="utf-8") if (ROOT / "public" / "attrib.js").exists() else ""
check("attribution: the source-code script exists and keeps first touch for the tab",
      "sessionStorage" in _attrib and "utm_source" in _attrib and "utm_campaign" in _attrib and "ref" in _attrib
      and "if (!first || !first.code)" in _attrib)
check("attribution: it sends nothing anywhere (no fetch, no beacon, no cookie)",
      _attrib and not re.search(r"fetch\(|sendBeacon|document\.cookie|XMLHttpRequest", _attrib))
_wa_untagged, _wa_noscript = [], []
for _p in SITE_PAGES:
    _h = _p.read_text(encoding="utf-8")
    _links = re.findall(r"https://wa\.me/\d+\?text=([^\"']*)", _h)
    if not _links: continue
    _rel = str(_p.relative_to(ROOT / "public"))
    if "attrib.js" not in _h: _wa_noscript.append(_rel)
    _wa_untagged += [_rel for t in _links if not re.match(r"(Hi|Hello|Namaste)%20Parwah(%21)?%20\([A-Z0-9]{2,12}\)", t)]
check("attribution: every public page with a WhatsApp button loads attrib.js", not _wa_noscript, ", ".join(_wa_noscript))
check("attribution: every WhatsApp button pre-fills a source code after the greeting", not _wa_untagged, ", ".join(sorted(set(_wa_untagged))))
_launch = (ROOT / "public" / "launch" / "index.html").read_text(encoding="utf-8")
check("attribution: the launch form sends the campaign labels with the join",
      all(f"{k}:(window.parwahAttribution||{{}}).{k}" in _launch for k in ("utm_source", "utm_medium", "utm_campaign", "ref")))
check("attribution: the list stores them, first touch kept on a re-join",
      all(f"add column if not exists {k} text" in _dbsrc for k in ("utm_source", "utm_medium", "utm_campaign", "ref"))
      and "utm_source = coalesce(waitlist.utm_source, excluded.utm_source)" in _auth_src
      and "normUtm" in _wl)

# INSTALL TRUST. /get/ offers the apps themselves (owner, 2026-11-09): the
# Android APK, served from this site, and the iPhone Web Clip profile, each
# with its honest note and the browser way as the other way. Nothing comes
# from GitHub (the repo goes private), and no IPA is offered: it cannot
# install on an iPhone without an Apple developer account.
_get = (ROOT / "public" / "get" / "index.html").read_text(encoding="utf-8")
_apk = ROOT / "public" / "downloads" / "parwah.apk"
_andcard = _get[_get.find('id="p-android"'):_get.find('id="p-ios"')]
_ioscard = _get[_get.find('id="p-ios"'):_get.find('id="p-desk"')]
check("get: no call to the GitHub API from the page (rate-limited for visitors, and the repo may go private)", "api.github.com" not in _get)
check("get: Android leads with Download the Android app, from this site, with Chrome as the other way",
      'class="getbtn" id="apk-link" href="../downloads/parwah.apk"' in _andcard
      and 'id="android-open" href="../"' in _andcard and "Add to Home screen" in _andcard and "Play Store" in _andcard)
def _apk_ok(p):
    import zipfile
    try:
        with zipfile.ZipFile(p) as z:
            n = z.namelist()
        return "AndroidManifest.xml" in n and "classes.dex" in n and any(x.startswith("META-INF/") for x in n)
    except Exception:
        return False
check("get: the Android app the button downloads is on this site and is a real APK",
      _apk.is_file() and _apk_ok(_apk), str(_apk))
check("get: on iPhone, Install the iPhone app is the main button (owner, 2026-11-09), with Add to Home Screen as the other way",
      'class="getbtn" id="ios-get" href="../install/parwah.mobileconfig"' in _ioscard
      and 'id="ios-guide" href="../?install=ios"' in _ioscard and "Add to Home Screen" in _ioscard and "not signed" in _ioscard)
check("get: the APK is served as an Android package",
      any(h["source"] == "/downloads/parwah.apk" and any(x["key"] == "Content-Type" and x["value"] == "application/vnd.android.package-archive" for x in h["headers"])
          for h in _json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8")).get("headers", [])))
check("get: no download or link from GitHub, and no IPA (it cannot install on an iPhone)",
      "github.com" not in _get and ".ipa" not in _get)

# THE PRESS KIT. Facts that are true today, files a journalist can use.
_press_dir = ROOT / "public" / "press"
_press = (_press_dir / "index.html").read_text(encoding="utf-8") if (_press_dir / "index.html").exists() else ""
check("press: the kit exists and names the founder and the contact address",
      "Anchit Tandon, founder" in _press and "mailto:anchit.tandon@gmail.com" in _press)
_press_files = ["parwah-wordmark", "parwah-wordmark-on-dark", "parwah-lockup", "parwah-mark", "parwah-app-icon"]
_press_missing = [f + e for f in _press_files for e in (".svg", ".png") if not (_press_dir / (f + e)).exists()]
check("press: every logo ships as SVG and PNG", not _press_missing, ", ".join(_press_missing))
check("press: the SVG logos are outlines, so they look right without the fonts installed",
      all("<text" not in (_press_dir / (f + ".svg")).read_text(encoding="utf-8") for f in _press_files if (_press_dir / (f + ".svg")).exists()))
check("press: real app screenshots, each with alt text",
      len(re.findall(r'<img src="screen-[a-z-]+\.png"[^>]*alt="[^"]{30,}"', _press)) >= 4)
check("press: it says the price as it is (free now, a plan later) and never promises an emergency service",
      "Free for families" in _press and "coming later" in _press and "not an emergency service" in _press)
check("press: linked from the welcome footer and listed in the sitemap",
      "../press/" in (ROOT / "public" / "welcome" / "index.html").read_text(encoding="utf-8").split('class="f-links"')[1].split("</nav>")[0]
      and "/press/</loc>" in (ROOT / "public" / "sitemap.xml").read_text(encoding="utf-8"))

# MARKETING COPY OBEYS THE SAME RULES AS THE SITE. marketing/ is never
# deployed (.vercelignore), so it is checked where it exists: every .md, the
# render script (whose strings are copy too),
# render sources, and the alt text of every image. A creator brief has to
# list the words a creator must never say; that list sits between
# <!-- never-say --> and <!-- /never-say --> and is the only exemption.
_mk = REPO / "marketing"
_vignore = (REPO / ".vercelignore").read_text(encoding="utf-8")
check("marketing: the folder is kept out of every Vercel upload", "\nmarketing/" in _vignore)
# Vercel keeps the folder itself but strips every file in it, so "exists" is
# not enough: check only where the copy is actually present.
if _mk.exists() and any(f.is_file() for f in _mk.rglob("*.md")):
    _mk_files = [f for f in _mk.rglob("*") if f.is_file() and f.suffix in (".md", ".html", ".json", ".txt", ".mjs")]
    _MON = r"\b(monitor|track|watch over|keep an eye on)(s|ed|ing)?\s+(your\s+|their\s+|my\s+)?(parents?|mum|mom|dad|papa|mummy|maa|elders?)\b"
    _mk_bad = []
    for _f in _mk_files:
        _t = _f.read_text(encoding="utf-8")
        _t = re.sub(r"<!-- never-say -->.*?<!-- /never-say -->", " ", _t, flags=re.S)
        _t = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", _t, flags=re.S | re.I)
        _low = _t.lower()
        _hits = sorted({k for k, pat in BANNED.items() if re.search(pat, _low)})
        if re.search(_MON, _low): _hits.append("monitor/track the parent")
        for _needle, _label in EM_FORMS + EN_FORMS:
            if _needle.lower() in _low: _hits.append(_label)
        if _hits: _mk_bad.append(f"{_f.relative_to(REPO)}: {', '.join(_hits)}")
    check("marketing: no banned claim, condition, voice word, monitoring phrase or dash in any copy",
          not _mk_bad, "; ".join(_mk_bad[:4]))
    _alt_path = _mk / "alt.json"
    _alts = _json.loads(_alt_path.read_text(encoding="utf-8")) if _alt_path.exists() else {}
    _imgs = sorted(str(f.relative_to(_mk)) for f in _mk.rglob("*.png") if "_render" not in f.parts)
    _no_alt = [i for i in _imgs if len(str(_alts.get(i, ""))) < 20]
    check("marketing: every image has alt text (marketing/alt.json)", _imgs and not _no_alt, ", ".join(_no_alt[:5]))
    _cp = [f for f in _mk_files if "creators" in f.parts]
    check("marketing: creator posts carry the ASCI disclosure in the caption itself",
          any("Paid partnership with Parwah" in f.read_text(encoding="utf-8") for f in _cp))
else:
    print("SKIP  marketing: not in this build input (.vercelignore keeps it out) - checked on a full checkout")

# ---------- Family Memory, the bonding half (Nov 2026): Ek sawaal, Yaadein,
# Rasoi and the private reach-out nudge (api/_memorybond.mjs) ----------
_mb_api = (API_DIR / "_memorybond.mjs").read_text(encoding="utf-8")
_mb_seed_src = (API_DIR / "_bondseed.mjs").read_text(encoding="utf-8")
_mb_js = _app_src[_app_src.index("// ---------- family memory: stories, yaadein, recipes, nudges (api/_memorybond.mjs)"):_app_src.index("// ---------- end of family memory (api/_memorybond.mjs)")]
_mb_html = _app_src[_app_src.index('<div class="seg mbswitch" id="mb-switch"'):_app_src.index('<div id="book-list-view">')] \
    + _app_src[_app_src.index('<div class="msheet" id="mbsheet"'):_app_src.index('<!-- A question with two big answers')]
def _mb_list(name):
    _blk = _mb_seed_src[_mb_seed_src.index("export const " + name):]
    _blk = _blk[:min(i for i in (_blk.find("\n];"), _blk.find("\n};")) if i >= 0)]
    return [v for v in re.findall(r"'((?:[^'\\]|\\.)*)'", _blk) if " " in v]
_mb_story, _mb_tb, _mb_rc = _mb_list("STORY_SEED"), _mb_list("THROWBACK_SEED"), _mb_list("RECIPE_COPY")
_mb_copy = " ".join(_mb_story + _mb_tb + _mb_rc)
check("memory bond: it lives behind /api/book?area=bond, never a new serverless function",
      "if (area === 'bond') return bondApi(req, res);" in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and not (API_DIR / "memorybond.mjs").exists() and "MB_API = '/api/book?area=bond'" in _mb_js)
check("memory bond: every call goes through requireMember, and another family's id is a 403",
      "requireMember(sql, code, memberId, tokenOf(req))" in _mb_api and "'That is not in your ' + word" in _mb_api)
check("ek sawaal: off until the storyteller says yes on their own screen, like the daily check-in",
      "action === 'teller_answer'" in _mb_api and "t.status = 'yes'" in _mb_api and "It stays off unless you say yes" in _mb_js
      and "data-mbteller=\"yes\"" in _mb_js)
check("ek sawaal: one question a week, claimed once by the (person, week) index, pushed only when the claim wins",
      "create unique index if not exists stories_week_once on stories (about_member, ask_week) where kind = 'story'" in _mb_api
      and "on conflict (about_member, ask_week) where kind = 'story' do nothing returning id" in _mb_api
      and "if (ins[0])" in _mb_api and "export function weekOf" in _mb_api)
check("ek sawaal: Skip is quiet and a skipped question rests for 8 weeks",
      "skipWeeks: 8" in _mb_api and "s.skipped_at > ${restSince}::date" in _mb_api and "It will not be asked again for 8 weeks. Nobody is told." in _mb_js)
check(f"ek sawaal: about 52 warm questions, about half Hinglish ({len(_mb_story)}), plus group throwbacks ({len(_mb_tb)})",
      48 <= len(_mb_story) <= 60 and len([q for q in _mb_story if re.search(r"\b(aap|kya|kaise|kab|kaun|kaunsa|kaunsi|mein|tha|thi|the)\b", q, re.I)]) >= len(_mb_story) * 0.4
      and len(_mb_tb) >= 15)
check("ek sawaal: never morbid, and the server turns a morbid suggestion away",
      not re.search(r"too late|\bdeath\b|\bdie\b|dying|funeral|last wish|illness|disease", _mb_copy, re.I) and "MORBID.test(text)" in _mb_api)
_mb_hits = sorted({k for k, pat in BANNED.items() if re.search(pat, (_mb_copy + " " + _mb_html).lower())})
_mb_dash = [lab for nd, lab in EM_FORMS + EN_FORMS if nd.lower() in (_mb_seed_src + _mb_html + _mb_js).lower()]
check("memory bond: the questions, recipe help and screens pass the banned-words scan, with no dashes",
      not _mb_hits and not _mb_dash, ", ".join(_mb_hits + _mb_dash))
check("rasoi: recipes are for food: the form says so, nothing invites a home remedy, and the server refuses one",
      "Recipes here are for food: the dish, who made it, and how to make it." in _mb_js
      and all(x in _mb_js for x in _mb_rc)
      and not re.search(r"nuskh|remed|ilaaj|upchar|gharelu|kadha", (_mb_js + _mb_html + " ".join(_mb_rc)), re.I)
      and "NOT_FOOD.test(" in _mb_api)
check("stories: the storyteller decides who hears each answer (the whole family, some people, only me)",
      # Nov 2026: a relative who recorded a story for someone not on the app
      # stands in for the storyteller on that one story.
      "if (r.about_member !== me.id && r.recorded_by !== me.id) return { s: 403, e: 'Only the storyteller can do that' };" in _mb_api
      and "(s.visibility = 'circle' or s.about_member = ${me.id} or s.recorded_by = ${me.id} or (s.visibility = 'some' and ${me.id} = any(s.share_with)))" in _mb_api
      and "data-mbvis" in _mb_js)
check("voice: our own recorder, 3 minutes at most, an allow-listed type, a byte cap on the server, never auto-played",
      "MB_MAX_SECS = 180" in _mb_js and "audioBitsPerSecond: 24000" in _mb_js
      and "audioTypes: ['audio/webm', 'audio/ogg', 'audio/mp4']" in _mb_api and "audioMaxBytes: 720000" in _mb_api
      and "autoplay" not in (_mb_js + _mb_html) and ".play(" not in _mb_js and 'preload="none"' in _mb_js)
check("voice and photos stay out of the lists: fetched only when someone taps, and a recipe photo is small and never SVG",
      "(s.audio is not null) as has_audio" in _mb_api and "view === 'audio'" in _mb_api and "safeImageUri(body.photo)" in _mb_api
      and "photoMaxChars: 160000" in _mb_api)
check("family book: every story the reader may see, printed with window.print and a print stylesheet, no vendor",
      "window.print()" in _mb_js and "body.mbprint > *:not(#mb-book){display:none!important}" in _app_src and 'id="mb-book"' in _mb_html)
check("yaadein: at most once a day, hide for good, hide a person or dates, never about someone remembered",
      "primary key (member_id, day)" in _mb_api and "yaad_hidden" in _mb_api and "inRanges(c.day, prefs.hide_ranges)" in _mb_api
      and "add column if not exists remembered boolean not null default false" in _mb_api and "not m.remembered" in _mb_api
      and "Send to everyone who was there" in _mb_js and "Not this one" in _mb_js)
check("nudges: opt-in, at most weekly, private, a per-person and a global off, never a score or a feeling",
      "nudges_on boolean not null default false" in _mb_api and "primary key (member_id, week)" in _mb_api
      and "if (!prefs.nudges_on) return null;" in _mb_api and "nudgeWeeks: [2, 3, 4]" in _mb_api and "'never'" in _mb_api
      and "It has been a while with" in _mb_js and "Only you see this." in _mb_js
      and not re.search(r"\b(lonely|loneliness|streak|leaderboard|monitor\w*|surveil\w*)\b", (_mb_js + _mb_html + _mb_copy).lower()))
check("nudges: a family's call rota comes first; a group suggests a friend not talked to 1:1",
      "template = 'callrota'" in _mb_api and "c.kind = 'dm'" in _mb_api and "kind = 'call'" in _mb_api)
check("memory bond: families and groups both, with a throwback question and a group cookbook",
      "throwback_weeks" in _mb_api and "primary key (circle_id, week)" in _mb_api and "The group cookbook" in _mb_js
      and "Throwback question" in _mb_js)
check("memory bond: elder mode gets bigger, calmer cards",
      "body.senior .mbcard .mbq{font-size:var(--fs-24)}" in _app_src and "body.senior .mbcard .cbtn{min-height:56px" in _app_src)
check("memory bond: the forms ask in the app's own sheets, never confirm() or prompt()",
      "askSheet(" in _mb_js and "askText(" in _mb_js and not re.search(r"[^\w.](confirm|prompt)\(", _mb_js))

# ---------- 10t. The timer rings without waiting for GitHub ----------
# GitHub's scheduled runs came 3 to 7 hours apart, so every alert that must
# ring when nobody in that family has Parwah open runs in one place
# (runTick), from the tick AND from the first signed-in poll of each minute.
_evs = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_rt = _evs[_evs.index("export async function runTick"):_evs.index("export default async function handler")]
check("timer: one runTick covers every timed alert (tasks, plans, SOS, ladder, doses, visits, staff, renewals, rota, check-ins)",
      all(f in _rt for f in ("sweepReminders", "sweepOverdue", "sweepPlanReminders", "escalateStaleSos", "ladderEscalate",
                              "sweepDoses", "sweepVisitAsk", "sweepStaffLate", "sweepRenewals", "rotaSweep", "quietSweepAll")))
check("timer: each sweep runs on its own, so one feature's trouble never silences another",
      "const one = async f =>" in _rt and "await one(() => sweepRenewals(sql, id))" in _rt)
check("timer: the first signed-in poll of each minute runs it, under a short time budget",
      "await runTick(sql, PIGGYBACK_BUDGET_MS)" in _evs and "rateLimit(sql, 'tick', 'all', 1, 50, { failClosed: true })" in _evs)
check("timer: Vercel's once-a-day cron is the backstop",
      any(c.get("path", "").startswith("/api/events?tick") for c in _json.loads((REPO / "vercel.json").read_text(encoding="utf-8")).get("crons", [])))

# ---------- 10v. Chat bonding: voice notes, reactions, Dekh liya, quick polls ----------
# "Nani can't type fast, so she holds a button and talks." A voice note is a
# small recording of an allowed type, at most a minute, never sent to Ekta and
# never played by itself. A reaction is one per person per message and never
# pushes. A poll pushes once when it is asked, never per vote.
_cb = (API_DIR / "_chatbond.mjs").read_text(encoding="utf-8")
_cb_chats = (API_DIR / "chats.mjs").read_text(encoding="utf-8")
_cb_app = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
_cb_js = _cb_app[_cb_app.index("// ---------- chat bonding: voice notes"):_cb_app.index("// ---------- family call: instant video room")]
check("chat bonding: lives behind /api/chats in an underscore module (no new serverless function)",
      "from './_chatbond.mjs'" in _cb_chats and "action === 'react' || action === 'poll_create'" in _cb_chats)
check("chat bonding: voice notes reuse the SOS MIME allow-list, check the first bytes, and cap length and bytes",
      "SOS_AUDIO_TYPES.indexOf(m[1]) < 0" in _cb and "looksLike(m[1], head)" in _cb
      and "VOICE_MAX_SECS = 60" in _cb and "VOICE_MAX_BYTES = 384000" in _cb and "n * VOICE_BYTES_PER_SEC + VOICE_SLACK" in _cb)
check("chat bonding: Ekta reads a voice note as [voice note], never the sound",
      "r.kind === 'audio' ? '[voice note]'" in _cb_chats)
check("chat bonding: one reaction per person per message, and reactions never push",
      "primary key (message_id, member_id)" in _cb and "pushCircle" not in _cb
      and "// A reaction never pushes and never becomes a message." in _cb_chats)
check("chat bonding: one vote row per person per poll; a poll pushes once when asked, never per vote",
      "primary key (poll_id, member_id)" in _cb and "One push per person for a new poll; none per vote." in _cb_chats)
check("chat bonding: the chat list says what a voice note or poll is",
      "'🎙 Voice note ('" in _cb_chats and "'📊 Poll: '" in _cb_chats)
check("chat bonding: nothing plays by itself; play only on a tap",
      "autoplay" not in _cb_app.lower() and _cb_js.count(".play()") == 2 and "function vnToggle(id)" in _cb_js)
check("chat bonding: a refused microphone gets a plain sentence, never a console error",
      "The microphone is off for Parwah. Allow it in your phone settings to send a voice note." in _cb_js and "console." not in _cb_js)
check("chat bonding: senior mode holds to talk and has one big Dekh liya",
      "Hold to talk, let go to send" in _cb_app and "Dekh liya" in _cb_js and "bondSenior()" in _cb_js)
check("chat bonding: the audio shown in the page is checked before it is used",
      "var AUDIO_URI = /^data:audio\\/(webm|ogg|mp4|mpeg|aac);base64,[A-Za-z0-9+/]+={0,2}$/;" in _cb_js)
check("chat bonding: the db and browser tests run in test:db",
      all(f in _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
          for f in ("chatbond.dbtest.mjs", "chatbond.e2e.dbtest.mjs")))

# ---------- Rishtedaar: the wider family, named, with the chain ----------
_rz_kin = (API_DIR / "_kin.mjs").read_text(encoding="utf-8")
_rz_ev = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_rz_app = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
_rz_test = (ROOT / "tests" / "kintest.mjs").read_text(encoding="utf-8") if (ROOT / "tests" / "kintest.mjs").exists() else ""
_rz_pkg = (REPO / "package.json").read_text(encoding="utf-8")
check("rishtedaar: the kin arithmetic still imports nothing, so the gate runs it before npm install",
      not re.search(r"^\s*import\s", _rz_kin, re.M) and "require(" not in _rz_kin and "await import(" not in _rz_kin)
check("rishtedaar: the new exports exist beside the old ones",
      all(("export function " + n + "(") in _rz_kin for n in ("kinLabel", "kinInfo", "kinChain", "kinChainWords", "kinCloseness", "kinEveryone", "index", "placement"))
      and "export const NOT_CONNECTED" in _rz_kin)
check("rishtedaar: every walk is bounded, by people already seen and by a cap",
      "const WALK_CAP" in _rz_kin and "i < queue.length && i < WALK_CAP" in _rz_kin and "seen.has(x.id)" in _rz_kin and "guard++ < WALK_CAP" in _rz_kin)
check("rishtedaar: the near family keeps its old words; the wider family is named only where it said Family or nothing",
      "const near = lineLabel(by, fromId, toId);" in _rz_kin and "if (near && near !== 'Family') return near;" in _rz_kin)
check("rishtedaar: elder or younger is never guessed without both dates of birth",
      "if (!a || !b || !a.dob || !b.dob || a.dob === b.dob) return null;" in _rz_kin and "hindi = e === null ? null : e ? 'Jeth' : 'Devar'" in _rz_kin
      and "hindi = e === null ? null : e ? 'Jethani' : 'Devrani'" in _rz_kin)
check("rishtedaar: the home names are all there, in Latin letters",
      all(("'" + w + "'") in _rz_kin for w in ("Jeth", "Jethani", "Devar", "Devrani", "Nanad", "Nandoi", "Saala", "Saali", "Salhaj", "Saadhu", "Bhabhi", "Jija",
                                                 "Samdhi", "Samdhan", "Dada", "Dadi", "Nana", "Nani"))
      and not re.search(r"[\u0900-\u097F]", _rz_kin))
check("rishtedaar: not connected is said plainly, and a link is never made up",
      "export const NOT_CONNECTED = 'Not connected in the family tree yet';" in _rz_kin and "return seen.has(toId) ? chainFrom(by, seen, toId) : null;" in _rz_kin)
check("rishtedaar: the server works the list out for whoever is looking, so app and server cannot disagree",
      "kinEveryone(by, g.me.id)" in _rz_ev and "kinChainWords(ri.chain, firstNames)" in _rz_ev and "group: ri.closeness" in _rz_ev
      and "dob: m.dob" in _rz_ev and "kinLabel(by, g.me.id, m.id)" in _rz_ev
      # The app draws what it is sent; it carries no second copy of the arithmetic.
      and "lineLabel" not in _rz_app and "kinChain(" not in _rz_app)
check("rishtedaar: the screen exists: the list, its subtitle, search, the chain sheet and Add a relative",
      all(('id="' + i + '"') in _rz_app for i in ("rz-open", "rz-sheet", "rz-q", "rz-list", "rz-note", "rz-add", "rz-who", "rz-who-chain", "rz-who-call", "rz-who-page", "rz-who-place"))
      and ">Rishtedaar</h3>" in _rz_app and ">Everyone you are related to, near and far</p>" in _rz_app and ">Add a relative</button>" in _rz_app)
check("rishtedaar: three groups, then who is not in the tree yet",
      "['ghar', 'Ghar: your own home'], ['kareebi', 'Kareebi: close family'], ['door', 'Door ke rishtedaar: the wider family']" in _rz_app
      and "Not in the tree yet</p>" in _rz_app and "data-rzplace=" in _rz_app)
check("rishtedaar: loading, empty, error and offline each say something",
      "Loading your family" in _rz_app and "You are not in the tree yet. Start with yourself" in _rz_app
      and "Could not load your family just now." in _rz_app and "You are offline. This is your family as this phone last saw it." in _rz_app
      and "rzFail('error')" in _rz_app and "rzFail('offline')" in _rz_app)
check("rishtedaar: a call button only for a phone the family read already sent, as the profile sheet does",
      "if (m.phone) { $('rz-who-call').href = 'tel:' + encodeURIComponent(m.phone); $('rz-who-call').hidden = false; }" in _rz_app
      and "$('rz-who-call').removeAttribute('href')" in _rz_app)
check("rishtedaar: placing and adding reuse the existing tree form, which gets a search box when the family is long",
      "function rzPlace(id)" in _rz_app and "sel.value = id; trChanged();" in _rz_app and "$('rz-add').addEventListener('click', function(){ rzPlace('new'); });" in _rz_app
      and "others = rzOfFilter(others, ofSel);" in _rz_app and 'id="rz-offind"' in _rz_app
      and "action: isNew ? 'add_person' : 'place'" in _rz_app)
check("rishtedaar: a person's page says how you are related, and the chain on a tap",
      'id="rz-pp-kin"' in _rz_app and 'id="rz-pp-chain"' in _rz_app and "rzPersonLine(m);" in _rz_app and "how are we related?" in _rz_app)
_rz_ids = re.findall(r'id="(rz-[a-z-]+)"', _rz_app)
check("rishtedaar: its ids are its own and none is used twice", len(_rz_ids) >= 15 and len(_rz_ids) == len(set(_rz_ids)))
check("rishtedaar: no Devanagari in the list; the home names are in Latin letters like Chacha and Mausi",
      not re.search(r"[\u0900-\u097F]", _rz_app[_rz_app.index("// ---------- Rishtedaar: everyone you are related to"):_rz_app.index("// ---------- location sharing (consent first)")]))
check("rishtedaar: the wide family is unit-tested in the gate, and the browser test runs in test:db",
      "DOOR KE RISHTEDAAR" in _rz_test and "a loop or a broken link never hangs a walk" in _rz_test
      and (ROOT / "tests" / "db" / "rishtedaar.e2e.dbtest.mjs").exists()
      and _rz_pkg.rstrip().count("site/tests/db/rishtedaar.e2e.dbtest.mjs") == 1)
# ---------- 10z. The family register ("When I'm Not Here", grown up) ----------
# Property, money, papers, things, online accounts and anything else, each
# with one of four choices of who sees it. Behaviour is proved against a real
# database in famregister.dbtest and in real browsers in famregister.e2e;
# these keep the source honest.
_fr = (API_DIR / "_register.mjs").read_text(encoding="utf-8")
_fr_api = (API_DIR / "_careprep.mjs").read_text(encoding="utf-8")
_fr_app = (REPO / "site/public/index.html").read_text(encoding="utf-8")
_fr_who = [("ONLY_ME", "Only me"), ("NOMINEES_ONLY", "People I choose"), ("IMMEDIATE", "Whole family"), ("EMERGENCY_ONLY", "Only in an emergency")]
check("register: the four choices exist on the server, on the form and on each entry's chip",
      "export const UNLOCK_POLICIES = ['IMMEDIATE', 'EMERGENCY_ONLY', 'NOMINEES_ONLY', 'ONLY_ME'];" in _fr
      and all(f"['{k}', '{l}']" in _fr for k, l in _fr_who)
      and all(f'<input type="radio" name="fr-who" value="{k}"' in _fr_app and f"<b>{l}</b>" in _fr_app for k, l in _fr_who)
      and all(f"{k}: '{l}'" in _fr_app for k, l in _fr_who) and 'class="frchip"' in _fr_app)
check("register: one rule decides who reads an entry, and the handler sends nothing that has not been through it",
      _fr.count("export function canViewAssetLocator(") == 1 and "function canViewAssetLocator" not in _fr_api
      and "if (policy === 'ONLY_ME') return false;" in _fr
      and "if (!canView && policy === 'ONLY_ME') return null;" in _fr
      and "institution_or_item: null, identifier_mask: null, physical_location_notes: null" in _fr
      and _fr_api.count("registerRowFor(") == 2 and "locators.push(out)" in _fr_api
      and "physical_location_notes: canView" not in _fr_api and "can_view: canView" not in _fr_api)
check("register: \"Only me\" answers like an entry that was never written, to read or to change",
      "if (!entry) return res.status(404).json(gone);" in _fr_api
      and "if (!row || (!registerCanManage(row, g.me.id) && row.unlock_policy === 'ONLY_ME')) return res.status(404).json(gone);" in _fr_api)
check("register: only the person it is about, or whoever wrote it, can edit, re-share or remove",
      "return !!locator && !!memberId && (locator.person_id === memberId || locator.created_by === memberId);" in _fr
      and "action === 'locator_update' || action === 'locator_share' || action === 'locator_remove'" in _fr_api
      and "Only the person it is about, or whoever wrote it, can change this." in _fr_api)
check("register: once the person it is about makes it theirs alone, only they can widen it; the audit list keeps quiet about it",
      "if (row.unlock_policy === 'ONLY_ME' && row.person_id !== g.me.id) {" in _fr_api
      and _fr_api.count("l.unlock_policy = 'ONLY_ME'") == 2
      and "is not on Parwah yet, so an emergency could never open this" in _fr_api)
check("register: the people lists are refilled when the family arrives, not only when the screen opens",
      "if (frSig !== frPeopleSig) { frPeopleSig = frSig; try { frFillPeople(); } catch (e) {} }" in _app_src)
check("register: narrowing an entry that was for everyone says a Renewals reminder may remain",
      "frWas.unlock_policy === 'IMMEDIATE' && who !== 'IMMEDIATE'" in _app_src and "that reminder is still there for the family" in _app_src)
check("register: never a card number, CVV, OTP, PIN or password; a long number keeps its last 4",
      "const { noteRisk } = await import('./_notesapi.mjs');" in _fr_api
      and _fr_api.count("registerClean(req.body, { risk: noteRisk })") == 2
      and "const why = (risk && risk(seen)) || registerSecretRisk(seen);" in _fr and "digits !== 15 && digits !== 16" in _fr
      and "['title', title], ['label', label], ['identifier', rawId], ['where', where], ['inName', inNameText], ['nominee', nominee], ['note', note]" in _fr
      and "Parwah never keeps a password or a PIN. Write where it is kept, not what it is." in _fr
      and "identifier: registerIdentifier(rawId)," in _fr and ">= 7) return maskAssetIdentifier(" in _fr)
check("register: a view is written once per viewer, per entry, per day, and never for the person it is about",
      "primary key (locator_id, viewer_id, day)" in _fr_api and "on conflict (locator_id, viewer_id, day) do nothing" in _fr_api
      and "return !!locator && !!memberId && locator.person_id !== memberId;" in _fr
      and _fr_api.count("registerLogsView(") == 2 and "v.viewer_id <> ${meId}" in _fr_api and ">Seen by '" in _fr_app)
check("register: it grew the old table, by add column if not exists inside the care schema; no second store",
      _fr_api.count("create table if not exists legacy_asset_locators") == 1
      and all(f"alter table legacy_asset_locators add column if not exists {c} " in _fr_api
              for c in ("custom_label", "in_name_member", "in_name_text", "nominee", "approx_value", "value_currency", "due_on", "note"))
      and "create table if not exists legacy_asset_views" in _fr_api
      and not (API_DIR / "register.mjs").exists() and "area === 'locator'" in (API_DIR / "book.mjs").read_text(encoding="utf-8"))
_fr_kinds = re.findall(r"\['([A-Z_]+)', '[^']+'\]", _fr[_fr.index("export const REGISTER_GROUPS"):_fr.index("export const REGISTER_KIND_LABEL")])
_fr_sel = _fr_app[_fr_app.index('<select id="loc-cat">'):]
_fr_sel = _fr_sel[:_fr_sel.index("</select>")]
check(f"register: the picker offers every kind the server knows ({len(_fr_kinds)}), under six plain headings",
      len(_fr_kinds) == 22 and sorted(re.findall(r'<option value="([A-Z_]+)"', _fr_sel)) == sorted(_fr_kinds)
      and re.findall(r'<optgroup label="([^"]+)"', _fr_sel) == ["Home and land", "Money", "Papers", "Things", "Online", "Other"]
      and all(f"label: '{h}'" in _fr for h in ("Home and land", "Money", "Papers", "Things", "Online", "Other")))
check("register: the screen is the family's register, and still says When I'm not here",
      "<b>Family register</b><small>When I'm not here:" in _fr_app and '<button data-sec="locator">📒 Family register</button>' in _fr_app
      and 'id="fr-search"' in _fr_app and 'id="fr-person"' in _fr_app and "Add the first one" in _fr_app
      and "apiGet(frUrl('&brief=1'))" in _fr_app and "apiGet(frUrl('&id=' + encodeURIComponent(id)))" in _fr_app)
check("register: removing asks first, in the app's own sheet; errors go through humanFail",
      "askSheet('Remove this from the register?'" in _fr_app and "action: 'locator_remove'" in _fr_app
      and "humanFail(j.error, 'Could not save this. Try again in a moment.')" in _fr_app
      and "You are offline. The register will load when the internet is back." in _fr_app)
_fr_static = [i for i in _static_ids if i.startswith("fr-")]
check(f"register: its new ids all start with fr- and none is the first-run card's ({len(_fr_static)})",
      len(_fr_static) >= 20 and all(_fr_static.count(i) == 1 for i in _fr_static))
_testdb_fr = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
# Not "last": a check that needs its test to be the last entry breaks the
# moment the next feature appends its own, which is what happened here.
check("register: the unit test is in the gate, and both database tests run in test:db, one after the other",
      "node site/tests/famregistertest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and "site/tests/db/famregister.dbtest.mjs && node --import ./site/tests/db/register.mjs site/tests/db/famregister.e2e.dbtest.mjs" in _testdb_fr
      and (REPO / "site/tests/db/famregister.dbtest.mjs").exists() and (REPO / "site/tests/db/famregister.e2e.dbtest.mjs").exists())

# Watch together and splitting a cost (2026-11-12): proved in splitmathtest
# (the sums), plantogether.dbtest (the handlers on PostgreSQL) and
# plantogether.e2e (real phones). These guard what must not drift.
_tg = (API_DIR / "_together.mjs").read_text(encoding="utf-8")
_sp = (API_DIR / "_split.mjs").read_text(encoding="utf-8")
_spm = (API_DIR / "_splitmath.mjs").read_text(encoding="utf-8")
_tg_plans = (API_DIR / "plans.mjs").read_text(encoding="utf-8")
_tg_app = _app_src.split("// ---------- Watch or listen together (api/_together.mjs) ----------")[1].split("// ---------- games: Snakes & Ladders ----------")[0]
check("together and split: both ride /api/plans in underscore modules, never a new serverless function",
      "from './_together.mjs';" in _tg_plans and "from './_split.mjs';" in _tg_plans
      and "if (area === 'split' || (typeof body.action === 'string' && /^split_/.test(body.action)))" in _tg_plans
      and "var splitApi = '/api/plans?area=split';" in _app_src
      and not any((API_DIR / f).exists() for f in ("together.mjs", "split.mjs", "splitmath.mjs")))
check("together: a plan of kind together, on the plans table, made through the same create and answered through the same rsvp",
      "'trip', 'other', TOGETHER_KIND]" in _tg_plans and "export const TOGETHER_KIND = 'together';" in _tg
      and "tg = await togetherPrepare(sql, circle, me, body);" in _tg_plans and "togetherAnswer(sql, circle, me, rows[0].id, body.answer)" in _tg_plans
      and "create table" not in _tg and "pushCircle" not in _tg and "together: '🍿'" in (API_DIR / "_plansweep.mjs").read_text(encoding="utf-8"))
check("together: only the sender or a recipient can make a plan from a recommendation, in the query itself",
      "and (r.by_member = ${me.id} or exists (select 1 from pasand_rec_to t where t.rec_id = r.id and t.member_id = ${me.id}))" in _tg
      and "title = r[0].title; platform = r[0].platform || null; link = r[0].link || null;" in _tg)
check("together: a link is https only, under Pasand's own rule, on the server and again before it is put in the page",
      "import { isPlatform, isRecKind, platformName, cleanLink, credRisk } from './_pasandrules.mjs';" in _tg
      and _tg.count("cleanLink(") >= 2 and "noteRisk(v) || credRisk(v)" in _tg
      and "var on = pasandOn(p.platform), link = pasandLink(p.link)" in _tg_app
      and 'data-tgopen="1" href="\' + esc(link) + \'" target="_blank" rel="noopener noreferrer"' in _tg_app
      and "if (tgOn && pasandLinkErr(tgLink)) { fieldErr('tg-link', pasandLinkErr(tgLink)); return; }" in _app_src)
check("together: Open it shows from 10 minutes before until 3 hours after, and the call button starts the app's own family call",
      "TOGETHER_OPEN = { beforeMin: 10, afterMin: 180 }" in _tg and "n >= t - 10 * 60000 && n <= t + 180 * 60000" in _tg_app
      and "if (d.tgcall) askCall();" in _tg_app and "function askCall(){" in _app_src)
check("split: the screen and the server say it once, in the same words: Parwah does not move money",
      "export const SPLIT_NOTE = 'Parwah does not move money. This opens your own UPI app.';" in _sp
      and "var SP_NOTE = 'Parwah does not move money. This opens your own UPI app.';" in _tg_app
      and _tg_app.count("SP_NOTE") == 2 and 'id="sp-note"' in _tg_app)
check("split: every sum is whole paise; the sums file imports nothing and has no fraction in it",
      not re.search(r"^\s*import\s", _spm, re.M) and not re.search(r"parseFloat|toFixed|Math\.round|Math\.floor|Math\.ceil", _spm)
      and not re.search(r"\d\.\d", re.sub(r"'[^'\n]*'", "''", re.sub(r"//.*", "", _spm)))
      and "amount_paise bigint not null check (amount_paise > 0)" in _sp and "share_paise bigint not null" in _sp
      and "numeric" not in _sp and "Math.round" not in _sp and "parseFloat" not in _sp
      and "const amount = parsePaise(b.amount);" in _sp)
check("split: a UPI id reaches only the payer, only in rupees, and only when its owner already allowed them (pay_perms)",
      "join pay_perms pp on pp.method_id = p.id and pp.member_id = ${me.id}" in _sp
      and "const payees = rupees ? d.book.owes.filter(o => o.from === me.id).map(o => o.to) : [];" in _sp
      and "p.kind = 'upi'" in _sp and _sp.count("handle") == 3 and _sp.count("upiLink(") == 1
      and "if (!isUpiId(x.pa)) return null;" in _spm and "if ((x.cu || 'INR') !== 'INR') return null;" in _spm
      and _spm.count("encodeURIComponent(") == 2
      and "function splitUpi(u){ return /^upi:\\/\\/pay\\?[A-Za-z0-9%&=._~-]+$/.test(String(u || '')) ? String(u) : ''; }" in _tg_app)
check("split: a UPI PIN is never taken or kept, and no money is ever moved from here",
      "for (const k of Object.keys(b)) if (/pin$/i.test(k)) return bad(SPLIT_NO_PIN);" in _sp and "const risk = noteRisk(what);" in _sp
      and not re.search(r"fetch\(|https?://", _sp) and not re.search(r"type=.password|upi ?pin", _tg_app, re.I))
check("split: who sees a plan's costs is decided in the query: on the plan, or sharing one of its costs",
      "(p.by_member = ${me.id} or ${me.id}::uuid = any(p.going) or ${me.id}::uuid = any(p.maybe) or ${me.id}::uuid = any(p.invited)" in _sp
      and "if (!r[0].on_plan) return { err: bad(NOT_ON, 403) };" in _sp
      and _sp.count("await planFor(sql, circle, me,") == 5)
check("split: settling is two-sided, and a cost is changed only by whoever added it or made the plan",
      "check (paid_at is not null or received_at is not null)" in _sp and "where paid_at is null or received_at is null" in _sp
      and "if (r[0].paid_at && r[0].received_at) return bad('Both of you have confirmed this one, so it stays.', 409);" in _sp
      and "if (r[0].added_by !== me.id && g.plan.by_member !== me.id)" in _sp
      and "const line = d.book.owes.find(o => o.from === from && o.to === to);" in _sp)
_plans_src = (API_DIR / "plans.mjs").read_text(encoding="utf-8")
check("together and split: tables and columns through schemaOnce; every push names one person",
      "schemaOnce(() => togetherColumns(sql))" in _tg and "schemaOnce(() => splitTables(sql))" in _sp
      and _sp.count("await pushCircle(") == 1 and "await pushCircle(sql, circle.id, payload, { only: other });" in _sp)
check("split: a settle-up push is capped at six an hour from one person to one person; the action itself is never refused",
      "rateLimit(sql, 'split_push', me.id + ':' + other, 6, 3600, { failClosed: true })" in _sp
      and _sp.count("await splitTell(sql, circle, me, other, {") == 2 and "return bad('That is a lot" not in _sp)
check("split: a plan past its time with an unsettled ledger stays reachable: on the plan, any age, newest first, at most 20, marked settling",
      "export const SPLIT_SETTLING_MAX = 20;" in _sp and "order by p.at desc limit 200" in _sp
      and "moves.some(m => !(m.paid && m.received)) || ledger(list, moves).owes.length > 0" in _sp
      and "const openIds = await splitSettling(sql, circle, me);" in _plans_src and "true as settling" in _plans_src
      and "return res.status(200).json({ ok: true, plans, settling: past });" in _plans_src
      and '<p class="eyebrow" id="plist-settle">Costs to settle</p>' in _app_src
      and "renderPlans(j.plans, j.settling || [])" in _app_src)
check("plans: a plan with costs on it cannot be cancelled; the delete itself checks again",
      _plans_src.count("'This plan has costs on it. Remove the costs first, or settle up.'") == 2
      and "and not exists (select 1 from plan_costs k where k.plan_id = plans.id) returning id" in _plans_src
      and "await sql`delete from plans where id = ${rows[0].id}`;" not in _plans_src
      and "humanFail(j.error, 'Could not cancel this plan. Try again in a moment.')" in _app_src)
check("remembered people are refused by the server on a plan invite and on a cost (who paid, who shares, uneven shares)",
      "if (lost) return bad(lost.name + ' is remembered here, so cannot be invited.');" in _tg
      and "const goneWhy = (id) => gone.get(id) + ' is remembered here, so cannot be on a cost.';" in _sp
      and "if (gone.has(paidBy)) return { error: goneWhy(paidBy) };" in _sp and _sp.count("if (lost) return { error: goneWhy(lost) };") == 2)
check("together: a plan from a recommendation that did not go to everyone needs an explicit yes, said in the sheet above the button",
      "if (!r[0].to_all && body.shareConfirmed !== true) return bad(togetherShareLine(word), 409);" in _tg
      and "' will see this plan and its link.'" in _tg
      and "<p class=\"hint\" id=\"tg-share\">Everyone in the ' + word + ' will see this plan and its link.</p>" in _app_src
      and "shareConfirmed: !!$('tg-share') || undefined" in _app_src
      and _app_src.index('id="tg-share"') < _app_src.index('id="tg-send" data-tgfor='))
check("together and split: loading, empty, error and offline are all said, and errors go through humanFail",
      'id="sp-load">Loading' in _tg_app and 'id="sp-empty"' in _tg_app and 'id="sp-fail" role="alert"' in _tg_app
      and "No connection. The costs will show when you are back online." in _tg_app
      and "humanFail(j && j.error, 'Could not load the costs. Try again in a moment.')" in _tg_app
      and "humanFail(j.error, 'That did not work. Try again.')" in _tg_app.split("function splitPost(")[1][:500]
      and "humanFail(j.error, 'Could not set the plan. Try again.')" in _tg_app)
check("together and split: status is said in words and a mark, never by colour alone, and never in the vibe colours",
      "'✓ Is owed '" in _tg_app and "'! Owes '" in _tg_app and "'✓ All square'" in _tg_app and "(on ? '✔ ' : '') + a[1]" in _tg_app
      and not re.search(r"--(rani|peacock|flame|grad)\b", "".join(l for l in _app_src.splitlines() if re.match(r"\.(tg|sp)[a-z]", l))))
_tg_names = re.findall(r"^  function ([A-Za-z0-9_$]+)\(", _tg_app, re.M)
_tg_ids = sorted(set(re.findall(r'\bid="((?:tg|sp)-[a-z-]+)"', _app_src)))
check(f"together and split: every new function starts with together or split, every new id with tg- or sp- ({len(_tg_names)} functions, {len(_tg_ids)} ids)",
      len(_tg_names) >= 25 and all(re.match(r"(together|split)[A-Z]", n) for n in _tg_names)
      and len(_tg_ids) >= 20 and all(_static_ids.count(i) <= 1 for i in _tg_ids))
_testdb_tg = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("together and split: the sums are tested in the gate, and the database and browser tests are in test:db",
      "node site/tests/splitmathtest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and all(("site/tests/db/" + f) in _testdb_tg and (REPO / "site/tests/db" / f).exists() for f in ("plantogether.dbtest.mjs", "plantogether.e2e.dbtest.mjs")))
# ---------- 10za. "What needs doing": the checklist for when someone passes away ----------
# A list drawn from the family register. Behaviour is proved against a real
# database in afterloss.dbtest and in real browsers in afterloss.e2e; these
# keep the three promises in the source: one viewing rule, the words "not
# legal advice", and that starting a list never changes who sees an entry.
_al = (API_DIR / "_afterloss.mjs").read_text(encoding="utf-8")
_al_api = (API_DIR / "_afterlossapi.mjs").read_text(encoding="utf-8")
_al_app = _fr_app
_al_js = _al_app[_al_app.index('// ---------- "What needs doing"'):_al_app.index("// ---------- Biomarkers & SVG Trendlines")]
_al_html = _al_app[_al_app.index('<div class="alwrap" id="al-wrap">'):_al_app.index("<!-- ONE PERSON - the sections")]
_al_css = "\n".join(l for l in _al_app.splitlines() if l.startswith((".al", ".card p.al")))
_al_legal = "This is a list to help you remember, not legal advice. Rules differ by bank and state."
_al_sorry = "We are sorry. This list is here so nothing is forgotten."
check("afterloss: its rules import nothing, and take the register's viewing rule as an argument",
      not re.search(r"^\s*import\s", _al, re.M) and "rowFor(row, viewerId" in _al
      and "if (typeof rowFor !== 'function') throw" in _al)
check("afterloss: the single viewing rule is reused: registerRowFor, never a second rule",
      "import { registerRowFor, registerLogsView, registerSecretRisk } from './_register.mjs';" in _al_api
      and "afterlossSteps({ rows, viewerId: me.id, rowFor: registerRowFor, opens, marks })" in _al_api
      and "registerRowFor(row, m.id, opens(row, m.id))" in _al_api
      and not re.search(r"unlock_policy|designated_recipients|canViewAssetLocator\s*\(", _al_api)
      # The rules may label a step the viewer already holds as "only you";
      # they never compare a policy to decide whether to show one.
      and not re.search(r"unlock_policy\s*===\s*'(IMMEDIATE|NOMINEES_ONLY|EMERGENCY_ONLY)'|designated_recipients|canView", _al))
check("afterloss: starting a list never changes who sees an entry: this module never writes to the register",
      not re.search(r"(update|insert\s+into|delete\s+from)\s+legacy_asset_(locators|views)", _al_api, re.I)
      and "it never writes to legacy_asset_locators at all" in _al_api
      and _al_app.count("Starting it does not change who can see any entry in the register.") == 1)
check("afterloss: an active list is the emergency only for that person and the two who started it; a nominee's name opens nothing",
      "if (list.status !== 'active' || list.person_id !== row.person_id) return false;" in _al
      and "if (memberId === list.started_by || memberId === list.confirmed_by) return true;" in _al
      and "afterlossNominees" not in _al and "name is not a person" in _al
      and "inSos.has(row.person_id) || alOpens(row, g.me.id)" in _fr_api
      and "registerRowFor(row, g.me.id, emergency(row))" in _fr_api and "registerRowFor(r, g.me.id, emergency(r), { details: !brief })" in _fr_api)
check("afterloss: the register form says what Only in an emergency means now",
      "<b>Only in an emergency</b><small>Opens during an emergency, or when the family starts 'What needs doing' for this person.</small>" in _al_app)
check("afterloss: it says once, plainly, that it is not legal advice, and that it is sorry",
      f"export const AFTERLOSS_LEGAL = '{_al_legal}';" in _al and f"export const AFTERLOSS_SORRY = '{_al_sorry}';" in _al
      and _al_app.count(_al_legal) == 1 and _al_app.count(_al_sorry) == 1
      and f'<p class="hint" id="al-legal">{_al_legal}</p>' in _al_html and f'id="al-sorry">{_al_sorry}</p>' in _al_html)
check("afterloss: two people start it: a second adult is asked, and only they can confirm",
      "Choose a second adult in the family to confirm. Two people start this together." in _al
      and "where id = ${list.id} and status = 'pending' and ask_member = ${g.me.id} returning id" in _al_api
      and "on conflict (circle_id, person_id) do nothing returning id" in _al_api)
check("afterloss: a tick, an assignment and a note are one statement each, so none undoes another",
      _al_api.count("on conflict (list_id, step_key) do update set") == 3
      and "do update set done = excluded.done, done_by = excluded.done_by," in _al_api
      and "do update set assigned_to = excluded.assigned_to," in _al_api and "do update set note = excluded.note," in _al_api
      and _al_api.count("from afterloss_lists l where l.id = ${list.id} and l.status = 'active'") == 3)
check("afterloss: a note is checked for a card number, CVV, OTP, PIN or password",
      "afterlossNote(body.note, [noteRisk, registerSecretRisk])" in _al_api)
check("afterloss: its pushes are the ask (one place, at most three an hour per person about one person), the family once when it comes into force, and the two starters when the person closes it; nothing timed",
      _al_api.count("await pushCircle(") == 4 and "afterlossPush('ask', { starter: me.name, person: person.name }), { only: askId }" in _al_api
      and _al_api.count("afterlossPush('ask'") == 1 and _al_api.count("await pushAsk(sql, g.circle.id, g.me,") == 2
      and "rateLimit(sql, 'afterloss_ask', me.id + ':' + person.id, 3, 3600, { failClosed: true })" in _al_api
      and "afterlossPush(can.reopening ? 'reopened' : 'started'," in _al_api and _al_api.count("afterlossPush('void'") == 1
      and "runTick" not in _al_api and "setTimeout" not in _al_api and "remind" not in _al_api.lower())
check("afterloss: opening a closed list again goes through the start rule, waits for a second adult, and clears the old confirmation",
      _al_api.count("afterlossStartRule({ me: meRow, personId: list.person_id, members, askId: isUuid(body.askId) ? body.askId : null })") == 1
      and "confirmed_by = null, confirmed_at = ${rule.needs ? null : new Date().toISOString()}::timestamptz" in _al_api
      and "set status = ${state}, started_by = ${g.me.id}, ask_member = ${rule.needs ? rule.askId : null}," in _al_api
      and "set status = 'active', reopened_by" not in _al_api
      and "afterlossPost('afterloss_reopen', { listId: l.id, askId: alAskPick || null });" in _al_app)
check("afterloss: one adult alone is refused for someone on Parwah; in force means confirmed, or that one allowed start",
      "export const AFTERLOSS_NEEDS_SECOND = 'This needs a second adult on Parwah to confirm.';" in _al
      and "if (person && (person.user_id || person.on_app)) return { error: AFTERLOSS_NEEDS_SECOND, status: 400, solo: false };" in _al
      and "return !!list.confirmed_by || (list.solo === true && !personOnApp);" in _al
      and "if (!list.confirmed_by && list.solo !== true) return false;" in _al
      and "return !!r[0] && afterlossInForce(r[0], r[0].on_app);" in _al_api
      and ".filter(l => afterlossInForce(l, l.on_app));" in _al_api
      and "and status = 'active'`;\n    return !!r[0];" not in _al_api)
check("afterloss: the person it is about closes it and it is removed, with its steps; the mark comes off only if the list set it",
      "if (g.me.id === list.person_id) {" in _al_api and "await voidList(sql, g.circle.id, list)" in _al_api
      and "delete from afterloss_lists where id = ${list.id} and circle_id = ${circleId} returning set_remembered" in _al_api
      and "if (gone[0].set_remembered) {" in _al_api
      and "body: person + ' closed the list that was started for them.'" in _al
      and "Closing it removes it, and the people who started it are told." in _al_app)
check("afterloss: a list in force marks the person as remembered, with no date, and records that it did",
      "update members set remembered = true where id = ${list.person_id} and circle_id = ${circleId} and not remembered returning id" in _al_api
      and "update afterloss_lists set set_remembered = true where id = ${list.id}" in _al_api
      and _al_api.count("await markRemembered(sql, g.circle.id,") == 3 and "passed_year =" not in _al_api)
check("register: the comment on Only in an emergency says the real rule: the two who started and confirmed, never a nominee by name",
      "only the two who started and\n//                   confirmed it. A nominee is a name, and a name opens\n//                   nothing" in (API_DIR / "_register.mjs").read_text(encoding="utf-8")
      and "the nominee\n//                   the entry names" not in (API_DIR / "_register.mjs").read_text(encoding="utf-8"))
check("afterloss: the rule takes no members list and has no unused name key",
      "export function afterlossOpens(list, row, memberId) {" in _al and "nameKey" not in _al
      and "afterlossOpens(by.get(row.person_id), row, memberId)" in _al_api and "(inForce && afterlossOpens(list, row, memberId))" in _al_api and not re.search(r"afterlossOpens\([^)]*, members\)", _al_api))
check("afterloss: it rides behind /api/book as area=afterloss; tables are made through schemaOnce; every request passes requireMember",
      "if (area === 'afterloss' || (req.body && typeof req.body.action === 'string' && /^afterloss_/.test(req.body.action))) return afterlossApi(req, res);"
        in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and "await schemaOnce(() => afterlossTables(sql));" in _al_api and _al_api.count("await requireMember(sql,") == 2
      and "create table if not exists afterloss_lists" in _al_api and "create table if not exists afterloss_steps" in _al_api
      and "afterloss: '/api/book?area=afterloss'" in _al_app)
check("afterloss: the ways in are quiet text links, never a bright button, and nothing wears an alert colour",
      '<button type="button" class="linkbtn" id="al-open" aria-expanded="false" aria-controls="al-panel">When someone passes away: what needs doing</button>' in _al_html
      and '<button type="button" class="linkbtn" id="al-pp-link" hidden>When someone passes away: what needs doing</button>' in _al_app
      and 'class="go"' not in _al_html and 'class="go"' not in _al_js and 'class="cbtn"' not in _al_js and "urgent" not in _al_js
      and len(_al_css) > 800
      and not re.search(r"--alert|--sos|--rani|--flame|--sindoor|--marigold|--grad|tint-bad", _al_css)
      and ".albar i{background:var(--ok)}" in _al_css and "accent-color:var(--ok)" in _al_css)
check("afterloss: loading, empty, error and offline are each said, and errors go through humanFail",
      '<div class="ev" role="status">Loading…</div>' in _al_js and "Choose a person above." in _al_js
      and "You are offline. The list will load when the internet is back." in _al_js and "data-alretry" in _al_js
      and "humanFail(j.error, 'Try again in a moment.')" in _al_js and "humanFail(j.error, 'That did not work. Try again in a moment.')" in _al_js
      and not re.search(r"\b(alert|confirm|prompt)\(", _al_js))
check("afterloss: the writer of an Only me entry is told gently, and offered the register",
      "that nobody else can see. You may choose to share" in _al_js and 'data-alreg="1">Open the register</button>' in _al_js
      and "afterlossActiveFor(sql, g.circle.id, row.person_id)" in _fr_api)
_al_ids = ["al-top", "al-wrap", "al-open", "al-panel", "al-head", "al-sorry", "al-legal", "al-person", "al-body", "al-pp-link"]
_al_dyn = ["al-ask", "al-first", "al-onlyme", "al-progress", "al-reg"]
check(f"afterloss: its ids start with al-, each is in the page once, and none is the alarm sheet's ({len(_al_ids)})",
      all(_static_ids.count(i) == 1 for i in _al_ids)
      and sorted(set(re.findall(r'\bid="(al-[a-z-]+)"', _al_js))) == _al_dyn
      and not set(_al_ids + _al_dyn) & {"al-title", "al-sub", "al-done", "al-snooze", "al-close"})
_al_copy = _al + " " + _al_js + " " + _al_html
_al_hits = sorted({k for k, pat in BANNED.items() if re.search(pat, _al_copy.lower())})
_al_dash = [lab for nd, lab in EM_FORMS + EN_FORMS if nd.lower() in (_al + _al_api + _al_js + _al_html).lower()]
check("afterloss: every word passes the banned-words scan, with no dashes, no promise and no pity",
      not _al_hits and not _al_dash
      and not re.search(r"\b(guarantee|will be paid|entitled|legally|by law|tragic|suffer|alas)\b", _al_copy, re.I),
      ", ".join(_al_hits + _al_dash))
_testdb_al = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("afterloss: the unit test is in the gate, and both database tests run in test:db",
      "node site/tests/afterlosstest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and "node --import ./site/tests/db/register.mjs site/tests/db/afterloss.dbtest.mjs" in _testdb_al
      and "node --import ./site/tests/db/register.mjs site/tests/db/afterloss.e2e.dbtest.mjs" in _testdb_al
      and (REPO / "site/tests/db/afterloss.dbtest.mjs").exists() and (REPO / "site/tests/db/afterloss.e2e.dbtest.mjs").exists())
# ---------- The wider family: linked families, family facts, days of remembrance ----------
_wf_link = (API_DIR / "_famlink.mjs").read_text(encoding="utf-8")
_wf_fact = (API_DIR / "_famfacts.mjs").read_text(encoding="utf-8")
_wf_rem = (API_DIR / "_remember.mjs").read_text(encoding="utf-8")
_wf_rules = (API_DIR / "_rememberrules.mjs").read_text(encoding="utf-8")
_wf_kin = (API_DIR / "_kin.mjs").read_text(encoding="utf-8")
_wf_circ = (API_DIR / "circle.mjs").read_text(encoding="utf-8")
_wf_evt = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_wf_app = _app_src
_wf_code = lambda src: re.sub(r"(?m)^\s*//.*$", "", src)
check("wider: no new function; three modules behind /api/circle, handed their actions by prefix",
      all((API_DIR / f).exists() for f in ("_famlink.mjs", "_famfacts.mjs", "_remember.mjs"))
      and not any((API_DIR / f).exists() for f in ("famlink.mjs", "famfacts.mjs", "remember.mjs", "link.mjs", "facts.mjs"))
      and "famlinkAction(sql, req, circle, mRow[0], req.body)" in _wf_circ and "famfactsAction(sql, circle, mRow[0], req.body)" in _wf_circ
      and "rememberAction(sql, circle, mRow[0], req.body)" in _wf_circ
      and all(a in _wf_circ for a in ("'link_state'", "'link_request'", "'link_approve'", "'link_decline'", "'link_end'", "'fact_list'", "'fact_add'", "'fact_edit'", "'fact_remove'", "'remember_mark'", "'remember_undo'")))
check("wider: the caller is proved to be a member of this family before any of the three is asked",
      _wf_circ.index("const widerOf = ") < _wf_circ.index("await ownedMember(sql, circle.id, memberId, tokenOf(req), `id, name, role, dob, place, country`)") < _wf_circ.index("await famlinkAction("))
check("wider: each module makes its own tables through schemaOnce",
      all("await schemaOnce(() => " in m for m in (_wf_link, _wf_fact, _wf_rem))
      and "create table if not exists family_links" in _wf_link and "create table if not exists family_facts" in _wf_fact
      and "create table if not exists remember_sent" in _wf_rem and "alter table members add column if not exists passed_year int" in _wf_rem)
_wf_people = _wf_link[_wf_link.index("async function peopleOf("):_wf_link.index("async function linkState(")]
check("links: one read of the other family, and it names only what may cross",
      _wf_code(_wf_link).count("from members where circle_id = ${circleId}") == 1
      and "select id, name, gender, parent_id, spouse_id, to_char(dob, 'YYYY') as born, place," in _wf_people
      and "case when ${!!withPhones}::boolean then phone else null end as phone" in _wf_people
      and not re.search(r"\b(dob|relation|gift_info|country|role|user_id|remembered|passed_|remember_line|created_at)\b", _wf_people.replace("to_char(dob, 'YYYY') as born", "").replace("order by created_at, id", "")))
check("links: nothing else of a family is ever read by the link module",
      set(re.findall(r"(?:from|join|into|update)\s+([a-z_]+)\b", _wf_code(_wf_link))) <= {"family_links", "circles", "members", "events"}
      and not re.search(r"family_links|famlink", _wf_code(_wf_fact)))
check("links: a yes from an adult of the other family, either side ends it, six at most, one per pair",
      "if (iAmA || l.status !== 'pending') return bad('That request has already been dealt with', 404);" in _wf_link
      and "if (!adult()) return bad('An adult in the family answers this.', 403);" in _wf_link
      and "export const LINKS_MAX = 6;" in _wf_link and _wf_link.count("activeCount(sql, ") >= 3
      and "least(a_circle, b_circle), greatest(a_circle, b_circle)" in _wf_link and "where status in ('pending', 'active')" in _wf_link
      and "set status = 'ended', ended_by = ${me.id}, ended_at = now()" in _wf_link and "rateLimit(sql, 'join', clientIp(req), 12, 600, { failClosed: true })" in _wf_link)
check("links: asking is counted and fails closed: the join bucket per address, 10 tries a day per family (wrong codes too), 3 a day per pair, 6 a day reaching one family, 7 days after a no or a withdrawal",
      "export const LINK_LIMITS = { perDay: 10, perPairDay: 3, incomingDay: 6, coolDays: 7 };" in _wf_link
      and "rateLimit(sql, 'link_ask', circle.id, LINK_LIMITS.perDay, 86400, { failClosed: true })" in _wf_link
      and "rateLimit(sql, 'link_pair', circle.id + ':' + other.id, LINK_LIMITS.perPairDay, 86400, { failClosed: true })" in _wf_link
      and "rateLimit(sql, 'link_in', other.id, LINK_LIMITS.incomingDay, 86400, { failClosed: true })" in _wf_link
      and _wf_link.count("{ failClosed: true }") == 4 and "rateLimit(sql, 'link'," not in _wf_link
      and _wf_link.index("rateLimit(sql, 'link_ask'") < _wf_link.index("const other = await circleByCode(sql, body.otherCode);") < _wf_link.index("rateLimit(sql, 'link_in'") < _wf_link.index("insert into family_links (a_circle, b_circle, a_member, b_member, b_name, a_phones, asked_by)")
      and "rateLimit(sql, 'join', clientIp(req), 12, 600)" in (API_DIR / "circle.mjs").read_text(encoding="utf-8")
      and "(status = 'ended' and decided_at is null and ended_at > now() - make_interval(days => ${LINK_LIMITS.coolDays}))" in _wf_link
      and _wf_link.count("return slow();") == 4)
check("links: the two trees are joined in memory, by a pure function with ids that cannot collide",
      "export function joinGraphs(own, other, bridge, prefix = LINK_PREFIX)" in _wf_kin and "export function kinLinked(" in _wf_kin
      and "export const LINK_MAX_PEOPLE = 400;" in _wf_kin and not re.search(r"(?m)^import ", _wf_kin)
      and "kinLinked(ownShape, people.map(shape), { own: mine, other: theirs }, me.id," in _wf_link
      and "dob: p.born ? p.born + '-01-01' : null" in _wf_link)
check("facts: who reads a fact, and who may change it, is said in SQL",
      _wf_fact.count("f.by_member = ${me.id} or f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen))") == 2
      and _wf_fact.count("or (${elder}::boolean and (f.audience = 'family' or (f.audience = 'chosen' and ${me.id}::uuid = any(f.chosen)))))") == 2
      and "check (audience in ('family', 'chosen', 'me'))" in _wf_fact and "audience text not null default 'family'" in _wf_fact
      and "export const FACT_CUSTOMS_MAX = 20;" in _wf_fact and "['custom', 'A custom worth writing down', 600]" in _wf_fact)
check("facts: every text passes the notes rule (no card number, CVV, OTP or banking PIN)",
      "import { noteRisk } from './_notesapi.mjs';" in _wf_fact and _wf_fact.count("const risk = noteRisk(text);") == 2
      and "const risk = noteRisk(line);" in _wf_rem)
check("remembrance: only an adult marks or undoes (the marked person may undo their own mark, never set it), with the year at least",
      "if (!selfUndo && !isAdult(me.dob, today)) return bad('An adult in the family does this.', 403);" in _wf_rem
      and "const selfUndo = a === 'remember_undo' && body.targetId === me.id;" in _wf_rem
      and "if (t.id === me.id && !selfUndo) return bad('This is for someone else in the family.');" in _wf_rem
      and "const selfUndo = !body.on && t.id === me.id;" in _mb_api
      and "if (t.id === me.id && !selfUndo) return bad(400," in _mb_api
      and _wf_rem.index("if (!selfUndo && !isAdult(me.dob, today))") < _wf_rem.index("if (a === 'remember_mark')") < _wf_rem.index("if (a === 'remember_undo')")
      and "if (year === null) return { error: 'Write the year." in _wf_rules and not re.search(r"(?m)^import ", _wf_rules))
check("remembrance: marking destroys nothing undo cannot restore: the check-in time is never cleared",
      not re.search(r"set\s+checkin_by\s*=\s*null", _wf_rem) and "checkin_ask = null" not in _wf_rem
      and "Their check-in time is NOT cleared" in _wf_rem)
check("remembrance: someone who used Parwah in the last 30 days is not marked by one person; one rule for both ways in; a marked person on Parwah is told once",
      "export const REMEMBER_RECENT_DAYS = 30;" in _wf_rem
      and "if (!t.remembered && await rememberRecent(sql, t)) return bad(rememberRecentWhy(t.name), 409, { recent: true });" in _wf_rem
      and "' used Parwah recently. If this is right, ask them or an elder to check.'" in _wf_rem
      and "if (await rememberRecent(sql, full)) return bad(409, rememberRecentWhy(t.name));" in _mb_api
      and "' marked you as no longer with us. If this is a mistake, open Parwah to undo it.'" in _wf_rem
      and "rateLimit(sql, 'remember_tell', me.id + ':' + target.id, 3, 3600, { failClosed: true })" in _wf_rem
      and _wf_rem.count("await rememberTell(sql, circle.id, me, t);") == 1 and "await rememberTell(sql, circle.id, me, full);" in _mb_api)
check("remembrance: every sweep that would chase or name a remembered person skips them (check-ins, doses, tasks, the call rota, cards)",
      _fc_api.count("and not m.remembered") >= 2
      and _dz.count("and not exists (select 1 from members m where m.id = d.person_id and coalesce((to_jsonb(m)->>'remembered')::boolean, false))") == 2
      and _tasksrc.count("and not exists (select 1 from members m where m.id = requests.about_member and coalesce((to_jsonb(m)->>'remembered')::boolean, false))") == 2
      and _fc_api.count("and not exists (select 1 from members m where m.id = requests.about_member and coalesce((to_jsonb(m)->>'remembered')::boolean, false))") == 1
      and "if (!who || who.remembered || (who2 && who2.remembered) || dstr(c.date) > todayFor(who, nowMs)) continue;" in (API_DIR / "_bond.mjs").read_text(encoding="utf-8")
      and "if (!who || who.remembered || (who2 && who2.remembered)) continue;" in (API_DIR / "_bond.mjs").read_text(encoding="utf-8"))
check("remembrance: my own sheet offers to take a mistaken mark off, and never to set one",
      "$('rm-mp-open').hidden = (self && !gone) || !fam;" in _app_src and "This is a mistake. Take the mark off" in _app_src
      and "if (state && id === state.memberId) { rmUndoAsk(" in _app_src)
check("remembrance: the reminder is claimed once per person per year, and is wired into the timer",
      "primary key (member_id, year)" in _wf_rem and "on conflict do nothing returning member_id" in _wf_rem
      and "events += await one(() => sweepRemember(sql, id));" in _wf_evt
      and "where remembered and passed_month is not null and passed_day is not null limit 500`)" in _wf_evt
      and "remembrance: rememberToday(members)" in _wf_evt and "export const REMEMBER_EVE_HOUR = 18;" in _wf_rules)
_wf_bond = (API_DIR / "_bond.mjs").read_text(encoding="utf-8")
_wf_fc = (API_DIR / "_familycare.mjs").read_text(encoding="utf-8")
_wf_ps = (API_DIR / "_pasand.mjs").read_text(encoding="utf-8")
check("remembrance: no birthday or anniversary card, no check-in, no recommendation for someone remembered",
      "if (!m.dob || m.remembered) continue;" in _wf_bond and "if (m.remembered || w.remembered) continue;" in _wf_bond
      and _wf_fc.count("and not m.remembered") == 2 and "is remembered here, so is not asked" in _wf_fc
      and "others.filter(m => m.user_id && !m.remembered)" in _wf_ps and "is remembered here, so is not sent recommendations." in _wf_ps
      and "delete from cards where circle_id = ${circle.id} and auto_key is not null and delivered_at is null" in _wf_rem)
check("remembrance: the words are gentle and plain, never clinical, on the server and in the app",
      not re.search(r"(?i)\b(deceased|death anniversary|died|dead|expired|demise)\b", _wf_code(_wf_rem) + _wf_code(_wf_rules))
      and "day of remembrance." in _wf_rules and "var RM_MARK = '🪔 No longer with us';" in _wf_app
      and not re.search(r"(?i)\b(deceased|died|dead)\b", _wf_app[_wf_app.index('id="rm-sheet"'):_wf_app.index('id="asksheet"')]))
check("remembrance: every list of people asks one helper, and the marker is words, not a colour alone",
      "function onApp(m){ return !!m && m.on_app !== false && !rmGone(m); }" in _wf_app and "function rmTag(m)" in _wf_app
      and _wf_app.count("if (!m.dob || rmGone(m)) return;") == 2 and "esc(rmTag(m)) + '</small></button>';" in _wf_app
      and '<b>🪔 No longer with us</b>' in _wf_app and "rmRenderToday(data.remembrance);" in _wf_app)
check("wider: the linked tree is read only, and Rishtedaar gains the other family in the same groups",
      "var far = flRzRows(g[0], q);" in _wf_app and 'id="fl-trees"' in _wf_app and "Linked family: ' + esc(l.name)" in _wf_app
      and "data-mprof" not in _wf_app[_wf_app.index("function flPerson(l, p)"):_wf_app.index("function flRenderTrees()")]
      and "Nothing else is shared: no chats, no papers, no health, no location." in _wf_app)
check("wider: loading, empty with a first step, error and offline are all said; errors go through humanFail",
      all(t in _wf_app for t in ("Loading linked families…", "No linked family yet. Ask a related family for their family code.", "You are offline. Linked families will show when the internet is back.",
                                 "Loading family facts…", "Nothing is written down yet. Start with one thing you know", "You are offline. Family facts will show when the internet is back.",
                                 "humanFail(j && j.error, 'Could not load linked families. Try again in a moment.')", "humanFail(j && j.error, 'Could not load family facts. Try again in a moment.')",
                                 "humanFail(j.error, 'Could not save this. Try again in a moment.')")))
_wf_ids = [i for i in _static_ids if i.startswith(("fl-", "ff-", "rm-"))]
check(f"wider: its new ids start with fl-, ff- or rm-, and none is used twice ({len(_wf_ids)})",
      len(_wf_ids) >= 45 and all(_wf_ids.count(i) == 1 for i in _wf_ids))
_wf_db = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
_wf_e2e = (REPO / "site/tests/db/widerfamily.e2e.dbtest.mjs").read_text(encoding="utf-8")
# Other features add their tests too, so this never asks to be the last entry.
check("wider: the unit test is in the gate, and both database tests are in test:db, in order",
      "node site/tests/widerfamilytest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and "site/tests/db/widerfamily.dbtest.mjs && node --import ./site/tests/db/register.mjs site/tests/db/widerfamily.e2e.dbtest.mjs" in _wf_db)
check("wider: the browser test waits for what it checks, never for a fixed time",
      "waitForTimeout" not in _wf_e2e and "waitForFunction" in _wf_e2e and "waitForSelector" in _wf_e2e and _wf_e2e.count("await design(") >= 15)
check("wider: the design review is written down",
      "the wider family: linked families, family facts, days of remembrance (2026-11-12)" in (REPO / "docs/design/REVIEWS.md").read_text(encoding="utf-8"))
# ---------- 10z. Yaadon ki album: the family photo album ----------
# Proved in albumrulestest (the rules), album.dbtest (the handler on
# PostgreSQL) and album.e2e (real phones). These guard what must not drift:
# only a JPEG is kept and the sender's word for the type is never read; the
# bytes are served private, through the signed-in route; who sees a photo is
# said in every query; the bytes are touched in two functions only, so a
# move to file storage is one change; and the add sheet says the location
# is removed.
_ab = (API_DIR / "_album.mjs").read_text(encoding="utf-8")
_abr = (API_DIR / "_albumrules.mjs").read_text(encoding="utf-8")
_ab_js = _app_src[_app_src.index("// ---------- Yaadon ki album: the family's own photos (api/_album.mjs)"):_app_src.index("// ---------- end of Yaadon ki album (api/_album.mjs)")]
_ab_html = _app_src[_app_src.index('<div id="ab-root" hidden>'):_app_src.index('<div id="book-list-view">')] \
    + _app_src[_app_src.index('<div class="abview" id="ab-viewer"'):_app_src.index('<!-- FAMILY MEMORY sheets (api/_memorybond.mjs)')] \
    + _app_src[_app_src.index('<div class="card" id="ab-pp-card"'):_app_src.index('<div class="card"><h3>💡 Useful to know</h3>')]
_ab_code = "\n".join(l for l in _ab.splitlines() if not l.strip().startswith("//"))
def _ab_fn(name):
    _i = _ab_code.index("export async function " + name + "(")
    return _ab_code[_i:_ab_code.index("\n}\n", _i) + 3]
_ab_put, _ab_get = _ab_fn("albumPutBytes"), _ab_fn("albumGetBytes")
_ab_tables = _ab_code[_ab_code.index("async function albumTables(sql)"):]
_ab_tables = _ab_tables[:_ab_tables.index("\n}\n") + 3]
_AB_AUD = "(a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))"
check("album: it rides /api/book?area=album in an underscore module, never a new serverless function",
      "import albumApi from './_album.mjs';" in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and "if (area === 'album') return albumApi(req, res);" in (API_DIR / "book.mjs").read_text(encoding="utf-8")
      and "var AB_API = '/api/book?area=album';" in _ab_js and not (API_DIR / "album.mjs").exists()
      and not re.search(r"^\s*import\s", _abr, re.M))
check("album: only a JPEG is kept: the first bytes are read, and the size, the pixels and camera details are checked",
      "b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF" in _abr and "export function imageError(bytes, kind)" in _abr
      and "bytes.length > maxBytes" in _abr and "if (info.exif)" in _abr
      and "photoBytes: 600000" in _abr and "thumbBytes: 40000" in _abr
      and "imageError(pBytes, 'photo') || imageError(tBytes, 'thumb')" in _ab)
check("album: any APP1 (Exif or XMP) and any APP13 (IPTC, Photoshop) segment is refused, not only one labelled Exif",
      "if (m === 0xE1 || m === 0xED) exif = true;" in _abr and "b[i + 4] === 0x45 && b[i + 5] === 0x78" not in _abr)
check("album: a tag its owner took off is remembered, and whoever added the photo cannot put it back",
      "create table if not exists album_untagged" in _ab
      and "insert into album_untagged (photo_id, member_id) values (${p.id}, ${me.id}) on conflict do nothing" in _ab
      and "if (took[0]) return bad(took[0].name + ' took their name off this photo, so it stays off.', 409);" in _ab
      and _ab.index("if (took[0]) return bad(") < _ab.index("update album_photos set caption = ${words.caption}"))
check("remembered people are refused by the server as a chosen audience (family facts, albums) and as the person given an after-loss step; a photo tag is still allowed",
      "if (lost) return { error: lost.name + ' is remembered here, so cannot be chosen.' };" in _wf_fact
      and "if (lost) return bad(lost.name + ' is remembered here, so cannot be chosen.');" in _ab
      and "remembered" not in _ab.split("const peopleOf = async (list) => {")[1].split("const wordsOf")[0]
      and "if (m.remembered) return res.status(400).json({ ok: false, error: m.name + ' is remembered here, so cannot be given a step.' });" in _al_api
      and "if (m.remembered) return bad(m.name + ' is remembered here, so is not sent recommendations.');" in (API_DIR / "_pasand.mjs").read_text(encoding="utf-8"))
check("album: the sender's word for the type is never read; the server states image/jpeg itself",
      not re.search(r"\b(?:it|photo)\.(?:mime|type|contentType|fileMime|fileName|name)\b|\bbody\.(?:mime|type|contentType|fileMime|fileName)\b", _ab_code)
      and "content-type" not in _ab_code.lower().replace("res.setheader('content-type', 'image/jpeg')", "").replace("x-content-type-options", "")
      and "res.setHeader('Content-Type', 'image/jpeg');" in _ab and "res.setHeader('X-Content-Type-Options', 'nosniff');" in _ab)
check("album: a photo is served private, asked for again each time, and never as a public or shared address",
      "res.setHeader('Cache-Control', 'private, no-cache');" in _ab and _ab_code.count("Cache-Control") == 1
      and "public" not in _ab_code.lower() and "res.setHeader('Vary', 'X-Parwah-Token');" in _ab
      and "headers: authHeaders({})" in _ab_js.split("function albumFetch(")[1][:500]
      and "URL.createObjectURL(b)" in _ab_js.split("function albumFetch(")[1][:900]
      and "navigator.share" not in _ab_js and "wa.me" not in _ab_js and not re.search(r"download all|public link", _ab_js + _ab_html, re.I))
check(f"album: who may see a photo is decided in the query itself, every time one is read ({_ab_code.count(_AB_AUD)} queries)",
      _ab_code.count(_AB_AUD) >= 6 and _AB_AUD.replace("${me.id}", "${meId}") in _ab_get
      and all(_AB_AUD in _ab_code[m.start():m.start() + 1400] for m in re.finditer(r"from album_photos p\s+join album_albums a", _ab_code))
      and "export function albumCanSee(album, viewerId)" in _abr)
_ab_touch = [m.start() for m in re.finditer(r"album_bytes|\bb\.photo\b|\bb\.thumb\b|decode\(|encode\(", _ab_code)]
_ab_ok = [(_ab_code.index(f), _ab_code.index(f) + len(f)) for f in (_ab_put, _ab_get, _ab_tables)]
check("album: the picture bytes are read and written in two functions only, so a move to file storage is one change",
      len(_ab_touch) >= 4 and all(any(a <= t < b for a, b in _ab_ok) for t in _ab_touch)
      and "insert into album_bytes" in _ab_put and "from album_bytes b" in _ab_get
      and "insert into album_bytes" not in _ab_tables and "select" not in _ab_put
      and "THE ONLY TWO PLACES THE PICTURE BYTES ARE TOUCHED" in _ab
      and all("album_bytes" not in f.read_text(encoding="utf-8") for f in API_DIR.glob("*.mjs") if f.name != "_album.mjs")
      and "album_bytes" not in _app_src and "count, cap: ALBUM_MAX.perCircle" in _ab)
check("album: the add sheet says the location is removed, and the browser makes every photo a fresh JPEG before sending",
      "export const ALBUM_LOCATION_LINE = 'Parwah removes the location from your photos before saving them.';" in _abr
      and "var AB_LOCATION = 'Parwah removes the location from your photos before saving them.';" in _ab_js
      and "'<p class=\"hint ablead\" id=\"ab-a-loc\">' + AB_LOCATION + '</p>'" in _ab_js
      and "var AB_STEPS = [[1600, 0.8]," in _ab_js and "var AB_THUMB_STEPS = [[320, 0.7]," in _ab_js
      and "last.c.toBlob(res, 'image/jpeg', s[1])" in _ab_js and "if (b.size <= max)" in _ab_js
      and "photoBytes: 600000, thumbBytes: 40000, photoSide: 1600, thumbSide: 320, perRequest: 6" in _ab_js
      and 'accept="image/*" multiple hidden' in _ab_js and 'accept="image/*" capture="environment" hidden' in _ab_js)
check("album: 400 a circle, 6 a request, 60 an hour failing closed, and one request stays under Vercel's body limit",
      "perCircle: 400" in _abr and "perRequest: 6" in _abr and "perHour: 60" in _abr and "requestBytes: 3200000" in _abr
      and "rateLimit(sql, 'album_up', me.id, ALBUM_MAX.perHour, 3600, { failClosed: true })" in _ab
      and "where (select count(*) from album_photos where circle_id = ${circle.id}) < ${ALBUM_MAX.perCircle}" in _ab
      and "capError(before, items.length)" in _ab and "list.length > ALBUM_MAX.perRequest" in _ab and "total > ALBUM_MAX.requestBytes" in _ab)
check("album: tables through schemaOnce, every call through requireMember, ids through isUuid, failures through _fail",
      "schemaOnce(() => albumTables(sql))" in _ab and "requireMember(sql, code, memberId, tokenOf(req))" in _ab
      and _ab.count("isUuid(") >= 4 and "return fail(res, e);" in _ab and "return failDb(res, e);" in _ab
      and "noteRisk(caption.value)" in _ab and "noteRisk(name.value)" in _ab)
# Nov 2026: new photos in a family album push the family at most once a
# day (the count is kept on the server). The weekly photo still never pushes.
check("album: Today shows one older photo a week and never pushes (new photos push once a day at most); a person's page and Family Memory draw it too",
      _ab.count("pushCircle(") == 1 and "rateLimit(sql, 'album_push', circle.id, ALBUM_PUSH_PER_DAY, 86400, { failClosed: true })" in _ab
      and "pushCircle" not in _ab.split("async function todayView(")[1].split("export default async function albumApi")[0]
      and "weeklyPick(me.id, today, cands.map(c => c.id))" in _ab
      and "primary key (member_id, week)" in _ab_tables
      and "\n    albumTodayLoad();\n" in _app_src and "\n    albumPersonRender(id);\n" in _app_src
      and 'id="ab-today"' in _app_src and 'data-mbv="album"' in _app_src and "if (album) { albumLoad(); return; }" in _app_src
      and "<b>A photo from ' + esc(String(t.year)) + '</b>" in _ab_js)
check("album: removing asks first, errors go through humanFail, and every picture has alt text",
      _ab_js.count("askSheet(") >= 2 and "humanFail(j.error, 'That did not work. Try again.')" in _ab_js.split("function abPost(")[1][:900]
      and "'<img alt=\"' + esc(p.alt) + '\" data-abimg=" in _ab_js and "img.alt = p.alt;" in _ab_js
      and "alt: albumAlt(p.caption, people.map(x => x.name), p.taken_year)" in _ab
      and "You are offline. The album will show when you are back online." in _ab_js and "Loading the album…" in _ab_js
      and "No photos yet." in _ab_js and "data-abqretry" in _ab_js)
_ab_static = [i for i in _static_ids if i.startswith("ab-")]
check(f"album: its ids all start with ab-, each used once ({len(_ab_static)}), and its functions start with album or ab",
      len(_ab_static) >= 20 and all(_ab_static.count(i) == 1 for i in _ab_static)
      and all(re.match(r"(album[A-Z]|ab[A-Z])", f) for f in re.findall(r"\n  function ([A-Za-z0-9_]+)\(", _ab_js)))
_ab_hits = sorted({k for k, pat in BANNED.items() if re.search(pat, (_ab_js + " " + _ab_html + " " + _ab + " " + _abr).lower())})
_ab_dash = [lab for nd, lab in EM_FORMS + EN_FORMS if nd.lower() in (_ab_js + _ab_html + _ab + _abr).lower()]
check("album: its screens, messages and comments pass the banned-words scan, with no dashes",
      not _ab_hits and not _ab_dash, ", ".join(_ab_hits + _ab_dash))
_ab_testdb = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("album: the rules test runs in the gate, and the db and browser tests run in test:db",
      "node site/tests/albumrulestest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and all("site/tests/db/" + f in _ab_testdb and (REPO / "site/tests/db" / f).exists() for f in ("album.dbtest.mjs", "album.e2e.dbtest.mjs")))
check("album: the coverage map says it is live, with no storage account, and its review is written down",
      "| A shared family photo album | Live |" in (REPO / "docs/product/FAMILY_COVERAGE.md").read_text(encoding="utf-8")
      and "the family photo album" in (REPO / "docs/design/REVIEWS.md").read_text(encoding="utf-8"))
# ---------- 10z. "Aaj kya hua": the daily digest from Ekta ----------
# The owner accepted a small AI cost for this one feature. These checks keep
# it small: only the list is sent, one call per member per day, a cap per
# circle, never from the timer, and the plain version always there.
_dg = (API_DIR / "_digest.mjs").read_text(encoding="utf-8")
_dgr = (API_DIR / "_digestrules.mjs").read_text(encoding="utf-8")
_dg_ekta = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
_dg_ev = (API_DIR / "events.mjs").read_text(encoding="utf-8")
_dg_fn = lambda src, name: src[src.index(name):].split("\n}\n", 1)[0]
_dg_sweep = _dg_fn(_dg, "export async function digestSweep(")
_dg_gather = _dg_fn(_dg, "export async function digestGather(")
_dg_ask = _dg_fn(_dg, "async function digestAskModel(")
_dg_by = _dg_fn(_dg, "async function digestByModel(")
_dg_open = _dg_fn(_dg, "export async function digestOpen(")
check("digest: it rides /api/ekta in underscore modules, after requireMember, never a new serverless function",
      not (API_DIR / "digest.mjs").exists() and "/^digest(_|$)/.test(req.body.action)" in _dg_ekta
      and "const { digestHandle } = await import('./_digest.mjs');" in _dg_ekta
      and _dg_ekta.index("requireMember(sql, code, memberId, tokenOf(req))") < _dg_ekta.index("digestHandle(sql, circle, me, req, res)")
      and _dg_ekta.index("digestHandle(sql, circle, me, req, res)") < _dg_ekta.index("await spend(sql, circle.id, me.id, 'ekta')"))
check("digest: the rules module imports nothing, so the gate can test it before npm install",
      not re.search(r"^\s*import\s", _dgr, flags=re.M) and "await import(" not in _dgr and "require(" not in _dgr
      and "node site/tests/digesttest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8"))
check("digest: ONLY THE LIST IS SENT - the prompt is built from the facts' sentences and nothing else",
      "list.map((f, i) => (i + 1) + '. ' + f.text).join('\\n')" in _dgr
      and "const sent = facts.slice(0, 8), prompt = digestPrompt(sent);" in _dg_ask
      and "({ system: prompt.system, user: prompt.user, maxTokens: DG.maxTokens, timeoutMs: ms })" in _dg_ask
      and not re.search(r"\b(raw|row|sql|me\.|circle\.|phone|email)\b", _dg_ask.split("try {", 1)[1].split("} catch", 1)[0]))
check("digest: what is gathered is only what the viewer may open - each feature's own rule is in the SQL, and notes, the vault, the register and health numbers are never read",
      "b.visibility = 'circle' or b.about_member = ${mid} or b.by_member = ${mid}" in _dg_gather
      and "s.visibility = 'circle' or s.about_member = ${mid} or (s.visibility = 'some' and ${mid} = any(s.share_with))" in _dg_gather
      and "join pasand_rec_to t on t.rec_id = r.id and t.member_id = ${mid}" in _dg_gather
      and "for_member is distinct from ${mid} and for_member2 is distinct from ${mid}" in _dg_gather
      and not re.search(r"from\s+(notes|vault_\w+|legacy_asset_\w+|biomarker_records|pulse|messages|care_bills|care_expenses|pay_\w+|book_consent)\b", _dg)
      and "b.name" not in _dg_gather and "answer_text" not in _dg and "export function digestMaySee(" in _dgr)
check("digest: ONE CALL PER MEMBER PER DAY - the row is claimed final once, and only the claimer may ask the model",
      "primary key (member_id, day)" in _dg and "where digest_daily.final = false" in _dg_open
      and "if (mine[0] && evening) row = await digestByModel(" in _dg_open and _dg.count("digestByModel(") == 2
      and _dg.count("digestAskModel(") == 2 and "set model_tried = true" in _dg_by)
check("digest: THE CAP - 12 model calls a circle a day, taken in one statement, counted where the owner can read it",
      "capPerCircle: 12" in _dgr and "create table if not exists digest_usage" in _dg
      and "do update set calls = digest_usage.calls + 1" in _dg_by and "where digest_usage.calls < ${DG.capPerCircle}" in _dg_by
      and "if (!slot[0]) return null;" in _dg_by and _dg_by.index("if (!slot[0]) return null;") < _dg_by.index("digestAskModel(facts")
      and "set written = written + 1" in _dg_by)
check("digest: only with the server's own key, only in the evening, never for a quiet day, and no coins are charged",
      "if (!facts.length || !process.env.ANTHROPIC_API_KEY) return null;" in _dg_by and "eveningHour: 18" in _dgr
      and "spend(" not in _dg and "from './_coins.mjs'" not in _dg and "NO COINS ARE CHARGED" in _dg)
check("digest: NO TIMER-DRIVEN MODEL CALL - the 8pm notification is the plain first sentence, claimed once a day",
      "await one(() => digestSweep(sql, id));" in _dg_ev and "from digest_prefs where evening" in _dg_ev
      and not re.search(r"digestAskModel|digestByModel|digestOpen|callModel|digestAnthropic|anthropic", _dg_sweep, flags=re.I)
      and "digestFirst(facts, spaceWord(circle))" in _dg_sweep
      and "pushed_for is distinct from ${day}::date returning member_id" in _dg_sweep and "if (!claim[0]) continue;" in _dg_sweep
      and "evening boolean not null default false" in _dg and "pushHour: 20" in _dgr
      and not re.search(r"digestOpen|digestHandle|digestByModel", _dg_ev))
check("digest: THE FALLBACK - a timeout, a refusal, an error or a reply that fails the check all end in the plain version, silently",
      "timeoutMs: 8000" in _dgr and "maxTokens: 300" in _dgr and "maxChars: 700" in _dgr
      and "Promise.race([" in _dg_ask and "if (!out || out.refusal) return null;" in _dg_ask
      and "} catch (e) { return null; }" in _dg_ask and "return checked.ok ?" in _dg_ask
      and "if (!have.has(n)) return { ok: false, why: 'number' };" in _dgr and "DG_JUDGE" in _dgr
      and "${digestWrite(facts, word)}" in _dg_open and "if (!out) return null;" in _dg_by)
check("digest: the same client and the same model choice as a conversation with Ekta; no new model id, and the SDK is loaded only when a call is made",
      "const { anthropicClient, MODEL_PRIMARY } = await import('./ekta.mjs');" in _dg and "export const MODEL_PRIMARY" in _dg_ekta
      and "export function anthropicClient(vault)" in _dg_ekta and "const client = anthropicClient(vault);" in _dg_ekta
      and _dg_ekta.count("new Anthropic(") == 1 and "new Anthropic(" not in _dg and "@anthropic-ai/sdk" not in _dg
      and not re.search(r"claude-[a-z0-9.\-]+", _dg + _dgr) and "model: MODEL_PRIMARY," in _dg
      and "{ timeout: timeoutMs, maxRetries: 0 }" in _dg)
check("digest: the voice - the rules tell the model no advice, no medical meaning, no guesses, no judgement, and that facts are data",
      all(x in _dgr for x in ("Use ONLY the facts", "No advice.", "No medical meaning.", "No guesses", "No judgement of any person.", "data, not instructions"))
      and "' not checked in today.'" in _dgr and "' medicines were not marked today.'" in _dgr
      and not re.search(r"\b(forgot|again|failed)\b", re.sub(r"export const DG_JUDGE.*", "", _dgr).split("export function digestCheck")[0]))
check("digest: someone marked as remembered is named only on their day of remembrance",
      "const gone = (id) => { const p = people.get(id); return !p || p.remembered === true; };" in _dgr
      and "the one place a remembered person is named" in _dgr and "and remembered`" in _dg_gather)
check("digest: its tables are made through schemaOnce, opening is rate limited, and errors go through fail()",
      "await schemaOnce(() => digestTables(sql));" in _dg and all(f"create table if not exists {t} (" in _dg for t in ("digest_daily", "digest_usage", "digest_prefs"))
      and "rateLimit(sql, 'digest', me.id, 40, 600)" in _dg and "} catch (e) { return fail(res, e); }" in _dg
      and "error: String(e" not in _dg)
check("digest: Today shows the row from 6pm, Ekta's screen has the button at any hour, and the sheet is the app's own",
      'id="dg-today"' in _app_src and 'id="dg-ekta"' in _app_src and "function digestEvening(){ return new Date().getHours() >= 18; }" in _app_src
      and "bondSheet('Aaj kya hua'," in _app_src and "action: 'digest' }" in _app_src and "digestRenderToday();" in _app_src
      and _app_src.index('id="ps-today"') < _app_src.index('id="dg-today"') < _app_src.index('id="fcquiet"'))
check("digest: loading, error and offline each say so; errors go through humanFail; nothing is asked of the server until the row is opened",
      "Ekta is putting today together." in _app_src and "humanFail(j && j.error, 'Could not load today\\'s note. Try again in a moment.')" in _app_src
      and "You are offline. Aaj kya hua will load when the internet is back." in _app_src and 'id="dg-retry"' in _app_src
      and _app_src.count("action: 'digest' }") == 1 and "function digestLoad(){" in _app_src
      and "digestLoad" not in _app_src[_app_src.index("function digestRenderToday(){"):_app_src.index("function digestClockText(")])
check("digest: thumbs are one per member per day, the evening setting starts off, and senior mode has the words only",
      "action: 'digest_vote', vote: v" in _app_src and "action: 'digest_evening', on: on" in _app_src
      and "set vote = ${v}, voted_at = now()" in _dg and "if (digestSenior()) return h;" in _app_src
      and "Tell me each evening" in _app_src and "It is off until you turn it on." in _app_src
      and "Written by Ekta from what you can see in the family today." in _dg)
check("digest: one model call per member per UTC day as well as per local day, claimed before the circle's cap",
      "create table if not exists digest_model_claim" in _dg
      and "insert into digest_model_claim (member_id, day) values (${me.id}, ${utcDay}::date)" in _dg_by
      and _dg_by.index("insert into digest_model_claim") < _dg_by.index("insert into digest_usage"))
check("digest: if who is remembered cannot be read, nobody but the viewer may be named and no day of remembrance is announced",
      "catch (e) { unsure = true; }" in _dg_gather
      and "remembered: unsure ? p.id !== mid : remembered.has(p.id)" in _dg_gather
      and "raw.remembrance = unsure ? [] :" in _dg_gather
      and "q(() => sql`select id from members where circle_id = ${cid} and remembered`)" not in _dg)
check("digest: tomorrow's day of remembrance uses the reminder's own rule on the person's own clock, never a month-and-day string match",
      "import { remembranceDue } from './_rememberrules.mjs';" in _dg
      and "remembranceDue({ year: m.passed_year, month: m.passed_month, day: m.passed_day }, nowMs + 86400000, placeOf(m.place, m.country, null).tz)" in _dg_gather
      and "lpad(passed_month::text" not in _dg)
_dg_static = [i for i in _static_ids if i.startswith("dg-")]
_dg_all = set(re.findall(r'id="(dg-[a-z-]+)"', _app_src))
check(f"digest: its ids all start with dg- ({len(_dg_all)}), none twice in the page, and its functions start with digest",
      sorted(_dg_static) == ["dg-ekta", "dg-today"] and len(_dg_all) >= 12
      and not re.findall(r"function dg\w*\(", _app_src)
      and len(re.findall(r"function digest\w+\(", _app_src)) >= 10)
_testdb_dg = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("digest: the rules test runs in the gate, and the db and browser tests run in test:db with no key and no network",
      all(("site/tests/db/" + f) in _testdb_dg and (REPO / "site/tests/db" / f).exists() for f in ("digest.dbtest.mjs", "digest.e2e.dbtest.mjs"))
      and all("globalThis.fetch = async" in (REPO / "site/tests/db" / f).read_text(encoding="utf-8")
              and "digestSeams.callModel" in (REPO / "site/tests/db" / f).read_text(encoding="utf-8")
              and "waitForTimeout" not in (REPO / "site/tests/db" / f).read_text(encoding="utf-8")
              for f in ("digest.dbtest.mjs", "digest.e2e.dbtest.mjs"))
      and "getHours()" not in (REPO / "site/tests/db/digest.dbtest.mjs").read_text(encoding="utf-8"))

# ---------- 10z. BEING HEARD, AND ANSWERED (stream D, Nov 2026) ----------
# The rules that must never regress: who may read what is in the SQL; the
# private word is read by nobody else; a secret ballot sends no name; an
# empty card is never handed over; festivals change one at a time.
_hd = {n: (API_DIR / n).read_text(encoding="utf-8") for n in
       ("_heard.mjs", "_baat.mjs", "_heardrules.mjs", "_pulse.mjs", "_chatbond.mjs", "_bond.mjs", "_memorybond.mjs",
        "_album.mjs", "_pasand.mjs", "_coins.mjs", "_tyohaar.mjs", "_remember.mjs", "chats.mjs", "events.mjs")}
_hd_reads = re.findall(r"(?:from|update|into)\s+baat\b[^`]*`", _hd["_baat.mjs"])
check("heard: every query on a private word carries 'only the two of them' (or is the insert, or the timer's one reminder)",
      len(_hd_reads) >= 6 and all(("from_member = ${me.id}" in q or "to_member = ${me.id}" in q or q.lstrip().startswith("into baat")
                                   or "reminded_at is null" in q) for q in _hd_reads),
      str([q[:70] for q in _hd_reads if not ("from_member = ${me.id}" in q or "to_member = ${me.id}" in q or q.lstrip().startswith("into baat") or "reminded_at is null" in q)]))
_hd_others = [f.name for f in sorted(API_DIR.glob("*.mjs")) if f.name not in ("_baat.mjs", "_heard.mjs")
              and re.search(r"\b(from|join|into|update)\s+baat\b", f.read_text(encoding="utf-8"))]
check("heard: no other module reads a private word: not Ekta, not the digest, not the feed, not an admin screen",
      _hd_others == [] and "insert into events" not in _hd["_baat.mjs"] and "pushCircle(sql, circle.id, { ...baatPush" in _hd["_baat.mjs"]
      and all("baat" not in (API_DIR / n).read_text(encoding="utf-8") for n in ("ekta.mjs", "_ektalocal.mjs", "_digest.mjs", "_digestrules.mjs", "_famfacts.mjs")),
      str(_hd_others))
check("heard: the mood is private by default, and who may see an answer is in the query",
      "default 'self'" in _hd["_pulse.mjs"] and "p.tell = 'family' or p.member_id = ${viewerId}::uuid or (p.tell = 'one' and p.to_member = ${viewerId}::uuid)" in _hd["_pulse.mjs"]
      and "if (moodOnFeed(tell))" in _hd["_pulse.mjs"] and "export const moodOnFeed = (tell) => tell === 'family';" in _hd["_heardrules.mjs"]
      and "pulseToday(sql, circle.id, reqTz(req), g.me.id)" in _hd["events.mjs"] and "insert into events" not in _hd["events.mjs"].split("if (type === 'pulse')")[1].split("if (type === 'sos_ack'")[0])
check("heard: five moods, each a word with its emoji, and the same five on the screen",
      len(re.findall(r"\{ k: '\w+',\s+e: '[^']+', t: '[^']+',\s+en: '[^']+'", _hd["_heardrules.mjs"])) == 5
      and "data-hdmood" in _app_src and "<span><b>' + esc(x.t) + '</b><small>' + esc(x.en) + '</small></span>" in _app_src
      and "'🔒 Keep to myself'" in _app_src and "'👤 Tell only...'" in _app_src and "'👪 Tell the family'" in _app_src)
check("heard: a shukriya is read by the two, or the family when the writer chose; the weekly prompt is the fair pure rule and sends no count",
      "(s.from_member = ${me.id} or s.to_member = ${me.id} or s.audience = 'family')" in _hd["_heard.mjs"]
      and "shukriyaPick({ viewerId: me.id, members, thanked, suggested: counts, week })" in _hd["_heard.mjs"]
      and "return t ? { toId: t.id, name: t.name, onApp: t.on_app } : null;" in _hd["_heard.mjs"]
      and "!m.remembered" in _hd["_heardrules.mjs"].split("export function shukriyaPick")[1].split("export function shukriyaClean")[0])
check("heard: the weekly question shows answers only to someone who has answered, in the query; at least 40 questions",
      _hd["_heard.mjs"].count("exists (select 1 from sawaal_answers x where x.circle_id = a.circle_id and x.week = a.week and x.member_id = ${me.id})") == 2
      and len(re.findall(r"^  '[^\n]+[?.]',?$", _hd["_heardrules.mjs"].split("export const FAMILY_QUESTIONS = [")[1].split("];")[0], re.M)) >= 40)
check("heard: a secret ballot sends no name (chat polls and date polls), and one reminder is claimed by one UPDATE",
      "if (!p.secret) o.names.push(" in _hd["_chatbond.mjs"]
      and "yes: p.secret ? [] : pick('yes'), maybe: p.secret ? [] : pick('maybe'), no: p.secret ? [] : pick('no')," in _hd["_bond.mjs"]
      and "yesNames: p.secret ? [] :" in _hd["_bond.mjs"]
      and "update chat_polls set reminded_at = now() where id = ${p.id} and reminded_at is null returning id" in _hd["_chatbond.mjs"]
      and "update plan_polls set reminded_at = now() where id = ${p.id} and reminded_at is null returning id" in _hd["_bond.mjs"]
      and "update plan_polls set decided = ${JSON.stringify(decided)}::jsonb" in _hd["_bond.mjs"]
      and "...(p.secret ? [] : yes)" in _hd["_bond.mjs"])
check("heard: a vote for someone not on the app is kept with who cast it, and no vote is weighed by age or role",
      "by_member" in _hd["_chatbond.mjs"] and "proxyLabel(v.name, v.by_name)" in _hd["_chatbond.mjs"] and "proxyLabel(x.n, x.bn)" in _hd["_bond.mjs"]
      and not re.search(r"\b(dob|role|isAdult|weight)\b", _hd["_chatbond.mjs"])
      and not re.search(r"\b(dob|role|isAdult|weight)\b", _hd["_bond.mjs"].split("if (a === 'bond_poll_create')")[1].split("if (a === 'bond_poll_cancel')")[0]))
check("heard: an empty card is never marked as delivered, and the evening-before reminder never goes to the person",
      "if (!c.n) continue;                    // empty: not delivered" in _hd["_bond.mjs"]
      and _hd["_bond.mjs"].index("if (!c.n) continue;") < _hd["_bond.mjs"].index("const got = await sql`update cards set delivered_at = now()")
      and "m.id !== c.for_member && m.id !== c.for_member2" in _hd["_bond.mjs"] and "update cards set eve_at = now() where id = ${c.id} and eve_at is null returning id" in _hd["_bond.mjs"])
check("heard: festivals change one at a time with a feed line; nobody can replace the whole list",
      "bond_fest_set" not in _hd["_bond.mjs"] and "bond_fest_set" not in _app_src and "delete from circle_festivals where circle_id = ${circle.id}`" not in _hd["_bond.mjs"]
      and "if (got[0]) await feed(sql, circle.id, me.id, festChangeLine(me.name, f.name, f.icon, add));" in _hd["_bond.mjs"]
      and all(("key: '" + k + "'") in _hd["_tyohaar.mjs"] for k in ("janmashtami", "dussehra", "chhath", "baisakhi", "ugadi", "onam", "pongal", "eidfitr", "christmas", "gurunanak")))
check("heard: chat pages by a cursor compared in the database, deletes only my own message, mutes for me, and sends pushes together",
      "(m.created_at, m.id) < (select b.created_at, b.id from messages b where b.id = ${before}::uuid and b.chat_id = ${chat.id})" in _hd["chats.mjs"]
      and "delete from messages where id = ${body.messageId} and chat_id = ${chat.id} and member_id = ${me.id} returning id" in _hd["chats.mjs"]
      and "insert into chat_mutes (chat_id, member_id) values (${chat.id}, ${me.id})" in _hd["chats.mjs"]
      and "Promise.allSettled([...new Set(ids)].map(id => pushCircle(sql, circleId, payload, { only: id })))" in _hd["chats.mjs"]
      and not re.search(r"for \(const p of audience\) \{\s*(if \(pinged\[p\.id\]\) continue;\s*)?await pushCircle", _hd["chats.mjs"]))
check("heard: coins for being heard are small, once a day each, and capped; none for a mood or a private word",
      all(k in _hd["_coins.mjs"] for k in ("story_told: { n: 2", "card_line:  { n: 2", "sawaal:     { n: 2", "shukriya:   { n: 1"))
      and "if (coinsLeftToday(got[0].n) < rule.n) return 0;" in _hd["_coins.mjs"] and "export const HEARD_COIN_CAP = 6;" in _hd["_heardrules.mjs"]
      and "award" not in _hd["_baat.mjs"] and "award" not in _hd["_pulse.mjs"])
check("heard: a like noted for someone not on the app carries who wrote it, and their own first like replaces the notes",
      "by_member" in _hd["_pasand.mjs"] and "delete from pasand_likes where member_id = ${me.id} and circle_id = ${circle.id} and by_member is not null and by_member <> ${me.id}" in _hd["_pasand.mjs"]
      and "if (who.user_id) return bad(who.name + ' is on Parwah and writes their own likes.');" in _hd["_pasand.mjs"])
check("heard: a story is heard and answered, and one told for someone carries both names",
      "action === 'story_heard'" in _hd["_memorybond.mjs"] and "action === 'story_for'" in _hd["_memorybond.mjs"]
      and "export const toldByLine = (teller, recorder) => 'told by ' + first(teller) + ', recorded by ' + first(recorder);" in _hd["_heardrules.mjs"]
      and "if (t.remembered) return bad(400, t.name + ' is remembered here." in _hd["_memorybond.mjs"])
check("heard: photos take a reaction and a voice caption under the album's own audience rule, and one push a day",
      _hd["_album.mjs"].count("(a.audience = 'family' or a.by_member = ${me.id} or (a.audience = 'chosen' and ${me.id}::uuid = any(a.chosen)))") >= 7
      and "rateLimit(sql, 'album_push', circle.id, ALBUM_PUSH_PER_DAY, 86400, { failClosed: true })" in _hd["_album.mjs"]
      and "export const ALBUM_PUSH_PER_DAY = 1;" in _hd["_heardrules.mjs"] and "navigator.share({ files: [file]" in _app_src)
check("heard: a day of remembrance opens one memory card a year, and the timer has one line for the private word's reminder",
      "rememberCardOpen(sql, circleId, m.id, due.year, due.date)" in _hd["_remember.mjs"] and "unique (member_id, year)" in _hd["_heard.mjs"]
      and _hd["events.mjs"].count("heardSweepAll") == 1 and "export async function heardSweepAll(sql, nowMs = Date.now())" in _hd["_heard.mjs"])
check("heard: someone remembered is never suggested, asked, pushed or voted for",
      _hd["_heard.mjs"].count("not coalesce((to_jsonb(m)->>'remembered')::boolean, false)") >= 4
      and "if (t.remembered) return bad(first(t.name) + ' is remembered here.', 400);" in _hd["_baat.mjs"]
      and _hd["_chatbond.mjs"].count("not coalesce((to_jsonb(m)->>'remembered')::boolean, false)") >= 5)
_hd_static = [i for i in _static_ids if i.startswith("hd-")]
check(f"heard: its static ids all start with hd- ({len(_hd_static)}), none twice in the page, and its functions start with hd",
      sorted(_hd_static) == ["hd-bf-how", "hd-cv-more", "hd-person", "hd-pl-secret", "hd-today"]
      and len(re.findall(r"function hd[A-Z]\w*\(", _app_src)) >= 40, str(sorted(_hd_static)))
_hd_block = _app_src.split("// ---------- BEING HEARD, AND ANSWERED (api/_heard.mjs, api/_baat.mjs) ----------")[1].split("// ---------- family memory: stories, yaadein, recipes, nudges")[0]
check("heard: the screen's own words carry no long dash and no banned word, and no button is an emoji alone",
      not re.search("[" + chr(8211) + chr(8212) + "]", _hd_block + _hd["_heardrules.mjs"] + _hd["_heard.mjs"] + _hd["_baat.mjs"])
      and not re.search(r"\b(elderly|burden|cure|treat|heal|therapy|remedy|medicinal|prevents|reverses|clinically proven|doctor recommended|pain relief|guaranteed|arthritis|diabetes)\b", _hd_block + _hd["_heardrules.mjs"], re.I)
      and not re.search(r"<button[^>]*>(?:' \+ [a-z.\[\]0-9]+ \+ ')?[^A-Za-z<']{1,4}</button>", _hd_block))
_testdb_hd = _json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]["test:db"]
check("heard: the rules test runs in the gate, and the db and browser tests run in test:db and never wait a fixed time",
      "node site/tests/heardtest.mjs" in (REPO / "scripts/checks.sh").read_text(encoding="utf-8")
      and all(("site/tests/db/" + f) in _testdb_hd and (REPO / "site/tests/db" / f).exists()
              and "waitForTimeout" not in (REPO / "site/tests/db" / f).read_text(encoding="utf-8") for f in ("heard.dbtest.mjs", "heard.e2e.dbtest.mjs")))

# ---------- 11. Serverless function budget (Hobby plan allows 12) ----------
FN_CAP = 12
fns = [f for f in sorted(API_DIR.glob("*.mjs")) if not f.name.startswith("_")]
check(f"serverless functions within plan cap ({len(fns)}/{FN_CAP})", len(fns) <= FN_CAP,
      "merge endpoints behind a router (see api/diag.mjs) - deploys are REJECTED above the cap")

print()
if FAILS:
    print(f"{len(FAILS)} CHECK(S) FAILED"); sys.exit(1)
print("ALL SITE CHECKS PASS")
