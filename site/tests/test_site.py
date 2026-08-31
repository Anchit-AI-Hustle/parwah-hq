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
# every module that touches circle data must prove membership first
GUARDED = ["_boardapi", "_keysapi", "_pushapi", "_vaultapi", "book", "care", "chats", "circle", "events", "games", "plans"]
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

# 10f. THE VAULT — the promises made to the family are checked here, not
# trusted to the interface. A change that breaks one of these cannot deploy.
vault = (API_DIR / "_vaultapi.mjs").read_text(encoding="utf-8")
check("vault: a full identity number is never stored",
      "last4" in vault and not re.search(r"(number|aadhaar|pan)\s*(text|=\s*clean\()", vault),
      "only the last four digits may be persisted")
check("vault: Aadhaar numbers are checksum-verified", "verhoeffOk" in vault and "V_D" in vault)
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
app_src = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("vault: the app never renders more than a masked number",
      "'•••• •••• '" in app_src and "'••••' + esc(d.last4)" in app_src)

# 10g. WAY IN — a short invite code must not be the whole security model.
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

# 10h. COINS — the credit that pays for Ekta.
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

# 10i. MULTI-CIRCLE — a person in several families must see which needs them.
check("circles: each carries what is waiting in it",
      all(k in auth for k in ('"unread"', '"waiting"', '"openRequests"', '"live"')))
check("circles: your own messages never count as unread",
      "ms.member_id is distinct from m.id" in auth)
check("circles: unread respects private chats you are not in",
      "ch.kind = 'circle' or cm.member_id is not null" in auth)
appsrc = (REPO / "site/public/app/index.html").read_text(encoding="utf-8")
check("circles: the sign-in list leads with the circle that needs you",
      "circleSignals" in appsrc and "needsyou" in appsrc)

# 10j. MEMORY CONSENT — a fact about a person is that person's to share.
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

# 10k. ONBOARDING — a first-ever sign-in must explain the app, and everyone
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

# 10l. LAYOUT — sidebar-only controls must never reach the mobile tab bar.
check("layout: .side-only is specific enough to beat .tabs button",
      ".tabs .side-only{display:none}" in appsrc and ".tabs .side-only{display:flex}" in appsrc)
check("layout: the desktop content is not capped at a phone width",
      "body.inapp .wrap{max-width:1240px" in appsrc)
check("layout: Today uses two columns on a wide screen",
      "homerail" in appsrc and "homemain" in appsrc and "@media(min-width:1240px)" in appsrc)

# 10m. THINGS TO DO, SOS ESCALATION, PRICING.
care = (API_DIR / "care.mjs").read_text(encoding="utf-8")
events = (API_DIR / "events.mjs").read_text(encoding="utf-8")
plan = (API_DIR / "_planapi.mjs").read_text(encoding="utf-8")
check("todo: reminders and jobs are one list, not two tabs",
      "Anyone can pick these up" in appsrc and "'#qlist'" not in appsrc.split("id=\"qlist\"")[0])
check("todo: one form raises either kind, decided by who it is for",
      "who === 'any'" in appsrc and "request_create" in appsrc and "reminder_create" in appsrc)
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
# which imports the database driver — absent before npm install.
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
# Match CODE lines only — the comment explaining why pull and build were
# dropped necessarily names them, and tripped the first version of this.
_dcode = "\n".join(l for l in deploysh.splitlines() if not l.strip().startswith("#"))
check("deploy: source is deployed and built by Vercel, not pushed prebuilt",
      "vercel deploy --prod --yes" in _dcode and "--prebuilt" not in _dcode
      and "vercel pull" not in _dcode and "vercel build" not in _dcode)
check("deploy: works on a machine without flock (macOS)",
      "command -v flock" in deploysh and 'mkdir "$LOCK.d"' in deploysh)

# ---------- 11. Serverless function budget (Hobby plan allows 12) ----------
FN_CAP = 12
fns = [f for f in sorted(API_DIR.glob("*.mjs")) if not f.name.startswith("_")]
check(f"serverless functions within plan cap ({len(fns)}/{FN_CAP})", len(fns) <= FN_CAP,
      "merge endpoints behind a router (see api/diag.mjs) — deploys are REJECTED above the cap")

print()
if FAILS:
    print(f"{len(FAILS)} CHECK(S) FAILED"); sys.exit(1)
print("ALL SITE CHECKS PASS")
