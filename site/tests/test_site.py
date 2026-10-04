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
        # A query string selects a state of the page, not another file.
        target = (p.parent / href.split("#")[0].split("?")[0]).resolve()
        if target.is_dir(): target = target / "index.html"
        if not target.exists(): bad.append(href)
    check(f"internal links: {p.relative_to(ROOT)}", not bad, ", ".join(bad))

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
check("routing: no redirect can catch the API",
      not any("api" in r.get("source", "") or r.get("source") in ("/(.*)", "/:path*")
              for r in vj.get("redirects", [])))
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
_FA_ALLOWED = {"'self'", "https://parwah.floot.app", "capacitor://localhost", "https://localhost",
               "https://floot.com", "https://2fea47ff-4e55-4bdb-ae0a-46d1768aebeb.sandbox.floot.app"}
check("framing: the app may be framed only by the Parwah shell",
      bool(_fa_list) and set(_fa_list) <= _FA_ALLOWED and "https://parwah.floot.app" in _fa_list,
      " ".join(_fa_list))
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
      "const chk = checkNumber(kind, body.number);" in vault
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
      "approve_join" in circ and "decline_join" in circ and "Not a member of this circle" in circ)
check("rate limit: join attempts are capped", "rateLimit(sql, 'join'" in circ)
check("rate limit: sign-in attempts are capped", "rateLimit(sql, 'auth'" in auth)
check("rate limit: counted in the database, not per instance",
      "create table if not exists rate_limit" in dbsrc and "make_interval" in dbsrc)
check("rate limit: a broken limiter never locks the family out",
      "catch (e) { return true; }" in dbsrc)

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
check("memory: entries can be private to their subject",
      "visibility text not null default 'circle'" in book and "book_access" in book)
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
check("games: Ludo, Bhabhi and Vyapar are real games, not Coming soon tiles",
      all('data-bstart="' + k + '"' in appsrc for k in ("ludo", "bhabhi", "vyapar"))
      and "More coming" not in appsrc and "<small>Coming soon</small>" not in appsrc)
_bg = (API_DIR / "_boardgames.mjs").read_text(encoding="utf-8")
_gm = (API_DIR / "games.mjs").read_text(encoding="utf-8")
check("games: a board move saves only on the version it was made on (two taps never both land)",
      "coalesce((state->>'v')::int, 0) = ${v0}" in _gm)
check("games: in Bhabhi each player is sent only their own hand",
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
check("gate: the phone rules module has no imports at all",
      not re.search(r"^\s*import\s", phonemod, re.M))
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
check("guide: the number is backed by named gaps and a complete-N call to action",
      "gapCount" in book and "rd-gaps" in appsrc and "Complete " in appsrc)
check("guide: someone near a person living away is a first-class contact",
      "'local'" in book and "someone near them to call" in book)
check("guide: the pulse question still rotates daily on the server (the app no longer asks it on Today)",
      "styleFor" in pulse and len(re.findall(r"^\s{2}\w+: \{ name:", pulse, re.M)) == 5)
check("guide: an answer can quietly say a call would be nice",
      "call: true" in pulse and "could do with a call" in (API_DIR / "events.mjs").read_text(encoding="utf-8"))
check("guide: everyone in a circle sees the same question on the same day",
      "derived from the date" in pulse or "same style for everyone" in pulse)
check("plan: named as the guide names it, and never sells the removed mood question (Family Pulse)",
      "Parwah Family Plan" in plan and "'Family Readiness'" in plan and "Pulse" not in plan)

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
    ("plans.mjs",  ""):                   "a plan invites the whole circle",
    ("games.mjs",  "lobby is open"):      "an open lobby invites everyone",
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
# play while the first was mid-board, and two Saanp Seedhis were impossible.
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
check("ekta: the retrieval logic imports nothing, so the gate tests it early",
      not re.search(r"^\s*import\s", elocal, re.M))
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
      "'123456'" in _au and "'000000'" in _au)
check("signin: wrong PINs lock the account rather than allowing a million tries",
      "MAX_TRIES" in _au and "locked_until" in _authmjs and "lockMessage" in _authmjs)
# A PIN of 4 to 6 numbers or a password, the person's choice. An old 6-digit
# PIN signs in once, then a new one is chosen before any session is issued.
check("signin: a PIN of 4 to 6 numbers, or a password",
      "PIN_MIN = 4" in _au and "PIN_MAX = 6" in _au and "PASS_MIN = 8" in _au and "PIN_LEN" not in _au)
check("signin: an old 6-digit PIN is marked, and replaced before a session is issued",
      "add column if not exists secret_v" in _dbs and "changeSecret: true" in _authmjs
      and 0 < _authmjs.find("if (user.secret_v !== SECRET_V) {") < _authmjs.find("const token = newToken()"))
# The try is claimed in the database, while unlocked, BEFORE the PIN is
# checked. Read-check-then-write let a burst of guesses all be checked.
_claim = re.search(r"pin_tries = pin_tries \+ 1\s+where id = \$\{user\.id\} and \(locked_until is null or locked_until <= now\(\)\)", _authmjs)
check("signin: each try is claimed before it is checked, so a burst cannot beat the lock",
      _claim is not None and _claim.start() < _authmjs.find("verifyPin(body.pin, user.pin_salt, user.pin_hash)"))
check("signin: a background refresh proves itself with the session, not a PIN",
      "sessionUser(sql, tokenOf(req))" in _authmjs and "su.user_id === user.id" in _authmjs)
check("signin: the box takes a PIN or a password, typed out of sight",
      re.search(r'<input type="password" id="au-pin"', _appa) is not None
      and 'id="au-pin2"' in _appa and 'maxlength="6"' not in _appa.split('id="au-pin"')[1][:200])
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
      "Never reveal whether a number is registered" in _authmjs)
check("signin: approving a reset also kills that person's old sessions",
      "delete from sessions where user_id = ${r[0].user_id}" in _authmjs)
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
check("leak: the deploy verifier sends the key",
      "DIAG_KEY" in _verify and "probe=db&key=$DIAG_KEY" in _verify)
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
      "The 16 Choghadiya windows" in appday and 'id="mp-hours"' in appday
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
check("day: all twelve rashis are behind a disclosure too, yours is not",
      "See all twelve rashis" in appday and 'id="ho-mine"' in appday)
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
check("guide demo: the price comes last, per family, in both currencies",
      "2,499" in _demo and "per family, per year" in _demo and "29.99" in _demo)
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
_pos = [_home.index(m) for m in ('id="seniorui"', 'class="homehero"', 'id="frslot"', 'id="widgets"', 'id="btn-ecard"', 'id="more"')]
check("today: an elder's SOS and big buttons first, then the family's name and status, a new family's checklist, the four tiles, the emergency card, then More",
      _pos == sorted(_pos), str(_pos))
_above_more = _home[:_home.index('id="more"')]
check("today: five things and no more - four tiles and the emergency card (the family review: track 5, not 50)",
      len(_wnames) == 4 and _above_more.count('class="widget"') == 4 and 'id="btn-ecard"' in _above_more)
check("today: everything else is kept, one tap away under More",
      all(x in _home[_home.index('id="more"'):] for x in ('data-goto="chat"', 'data-sec="plans"', 'data-goto="ekta"', 'data-sec="muhurat"', 'data-sec="pay"', 'data-sec="games"', 'id="coincard"')))
check("today: no daily food or mood question (families already chat about that on WhatsApp)",
      'id="pulsecard"' not in _appt and "renderPulse" not in _appt and 'id="pu-pick"' not in _appt)
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
      'id="asksheet"' in _appt and "askSheet('Send SOS to the whole family?'" in _appt and "askSheet('Sign out on this phone?'" in _appt)
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
check("names: one name per place on tiles, tabs and menu, and family not circle in the copy",
      '<b>To do</b>' in _appt and 'Health &amp; contacts' in _appt and "Create the circle" not in _appt and "Your circle's helper" not in _appt)
_tsk = (API_DIR / "_tasks.mjs").read_text(encoding="utf-8")
check("to do: a time already gone means tomorrow at that clock time (not 24 hours on), and a task written down after its time wakes nobody",
      "nx.setDate(nx.getDate() + 1); at = new Date(localDay(nx) + 'T' + t)" in _appt and "at.getTime() + 86400000" not in _appt and "${dueAt && dueAt.getTime() < Date.now() ? dueAt : null}" in _tsk)
check("to do: asked but not yet agreed shows one decision; late shows Set a new time and a call",
      "var waitingYes = q.status === 'assigned' && owner;" in _appt and "'Set a new time', 'go'" in _appt and "about_member = ${aboutId}" in _tsk)
check("suggested: a gap is filled now, and any suggestion can be waved away",
      "data-sfill=" in _appt and "data-snot=" in _appt)
check("people: who is waiting, the tree, how ready (one line per person looked after), the family, then where",
      _appt.index('id="joinreq-card"') < _appt.index('id="treecard"') < _appt.index('id="prepcard"') < _appt.index('id="loc-card"')
      and "var looked = prepCache.filter(" in _appt)
check("people: the profile is a dialog with Call first and only the family word for a person",
      'id="msheet" hidden role="dialog"' in _appt and "' · senior mode'" not in _appt and "function mpClose()" in _appt)
check("staying current: an open or installed Parwah moves to a new version when it comes back to the screen, and the page is never served from the browser cache",
      "function checkUpdate()" in _appt and 'id="updbar"' in _appt
      and "fetch(url.href, { cache: 'no-store'" in (REPO / "site" / "public" / "sw.js").read_text(encoding="utf-8"))
_ekt = (API_DIR / "ekta.mjs").read_text(encoding="utf-8")
check("ekta: anyone in danger is answered first, in fixed words, free - before coins, keys or a model",
      -1 < _ekt.find("asked === 'emergency' || asked === 'crisis'") < _ekt.find("await spend(sql, circle.id, me.id, 'ekta')")
      and "function ektaUrgent(said)" in _appt and 'href="tel:112"' in _appt and "if (j.emergency) ektaUrgent(v);" in _appt)
check("ekta: the scam check, records and medicine questions are never charged; a family word finds the one person saved with it",
      "if (['scam', 'memory', 'summary', 'health'].includes(asked)) {" in _ekt and "localTurn(sql, circle, me, history, 'records')" in _ekt
      and _ekt.find("localTurn(sql, circle, me, history, 'records')") < _ekt.find("await spend(sql, circle.id, me.id, 'ekta')")
      and "kinIsAsked(text, members)" in _ekt and "renderWhoIsIt(names)" in _ekt and "renderWhoIsVisit(" in _ekt and "(e.about === subject || !e.about)" in _ekt)
check("ekta: out of coins still answers what was always free, and says how anyone can earn more",
      "Reading back your records, the scam check and anything urgent stay free." in _ekt and "EARN.checkin" not in _ekt
      and _ekt.find("asked === 'emergency' || asked === 'crisis'") < _ekt.rfind("await providerKeys(sql, circle.id)") and "ektaOffline(j.records ?" in _appt)
check("ekta: the screen says what she does, that she gives no medical advice and what a question costs; chips point at real things",
      "I never give medical advice. A question uses 2 coins" in _appt and "Daily check-in reminder" not in _appt and 'id="evoice" aria-pressed="true" aria-label="Read replies aloud"' in _appt)
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
check("games and the board: the floating buttons step aside; the paper stays white; the eraser erases; undo; a wipe asks",
      "body.nofab #ekta-fab" in _appt and "#dboard{width:100%;aspect-ratio:4/3;background:var(--card-face);" in _appt
      and "'destination-out'" in _appt and 'id="d-undo"' in _appt and "Wipe the whole board?" in _appt)
check("create: joint or nuclear is asked first, with no answer chosen for them",
      "var newFamilyType = null;" in _appt and _appt.index('id="c-ftype"') < _appt.index('id="c-circle"') < _appt.index('id="c-name"'))
check("roles: a new group asks for your role in the group, and starts on Friend",
      "'Who are you in this ' + newKind + '?'" in _appt and "newKind === 'group' ? 'friend' : 'family'" in _appt)
_loc = (API_DIR / "_locationapi.mjs").read_text(encoding="utf-8")
check("location: only the person turns it on; there is no action to share for someone else",
      "requireMember(sql, code, memberId, tokenOf(req))" in _loc and "values (${circle.id}, ${me.id}, true" in _loc
      and "otherId" not in _loc and "targetId" not in _loc)
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
_notype = {"--tabs-h", "--side-w", "--disp", "--body", "--dev", "color-scheme"}
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
_want_nav = ["home", "vault", "memory", "care", "people", "chat", "notifs", "ekta", "fun", "day", "profile"]
check("order: the sidebar runs by real-life use",
      [t for t, _ in _nav] == _want_nav, " > ".join(t for t, _ in _nav))
check("order: the phone tab bar is Today, Vault, Care, People (families chat on WhatsApp; the vault is what it cannot do)",
      [t for t, a in _nav if "deskonly" not in a] == ["home", "vault", "care", "people"],
      " > ".join(t for t, a in _nav if "deskonly" not in a))
_drw = _appt[_appt.index('<div class="dhead">'):_appt.index('id="d-groups-wrap"')]
_drw_top = re.findall(r'class="ditem(?: dparent)?" data-(?:tab|grp)="(\w+)"', _drw)
check("order: the menu drawer runs by real-life use",
      _drw_top == _want_nav, " > ".join(_drw_top))
check("order: on a parent's phone nothing floats over All is well, Pills or SOS",
      "@media(max-width:899px){body.senior .fab{display:none!important}}" in _css)
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
      'content="https://parwah-hq.anchit-tandon.com/og.png"' in _app_h)
# Meta tags are not tracking. This must not be read as permission to add any.
check("invite preview: the app still carries no analytics",
      "analytics.js" not in _app_h and "googletagmanager" not in _app_h)

# The image has to exist, at the size every platform crops to.
for _card in ("og.png", "og-story.png"):
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

# ---------- 11. Serverless function budget (Hobby plan allows 12) ----------
FN_CAP = 12
fns = [f for f in sorted(API_DIR.glob("*.mjs")) if not f.name.startswith("_")]
check(f"serverless functions within plan cap ({len(fns)}/{FN_CAP})", len(fns) <= FN_CAP,
      "merge endpoints behind a router (see api/diag.mjs) - deploys are REJECTED above the cap")

print()
if FAILS:
    print(f"{len(FAILS)} CHECK(S) FAILED"); sys.exit(1)
print("ALL SITE CHECKS PASS")
