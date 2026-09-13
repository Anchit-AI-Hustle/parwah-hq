#!/usr/bin/env python3
"""Test suite for parwah-site. Stdlib only. Run: python tests/test_site.py

All checks must pass before any commit (repo law, CLAUDE.md).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_PAGES = ["index.html", "story/index.html"]
REQUIRED_FILES = HTML_PAGES + [
    "favicon.svg",
    "robots.txt",
    "vercel.json",
    "CLAUDE.md",
    "README.md",
    "supabase/migrations/0001_waitlist.sql",
    "og.png",
    "og-story.png",
    "tests/browser.mjs",
]

TAGLINE = "They took care of you. Take care back."

# Claims checklist - banned in any public copy (hard guardrail).
BANNED_PATTERNS = {
    "cure": r"\bcure[sd]?\b",
    "treat": r"\btreat(s|ed|ing|ment|ments)?\b",
    "heal": r"\bheal(s|ed|ing)?\b",
    "therapy": r"\btherap(y|ies|eutic|ist)\b",
    "arthritis": r"\barthritis\b",
    "diabetes": r"\bdiabet(es|ic)\b",
    "clinically proven": r"clinically\s+proven",
    "doctor recommended": r"doctor[\s-]+recommended",
    # dignity-first voice: no "elderly", no burden framing
    "elderly": r"\belderly\b",
    "burden": r"\bburden(s|ed|some)?\b",
}

# Must never appear anywhere in this public repo.
SECRET_PATTERNS = {
    "service role key": r"service_role",
    "supabase secret key": r"sb_secret_",
    "master prompt leak": r"MASTER_PROMPT",
}

failures = []


def check(ok, label):
    if ok:
        print(f"  ok  {label}")
    else:
        failures.append(label)
        print(f"FAIL  {label}")


def visible_text(html):
    """Strip tags, scripts and styles - banned-word check runs on copy only,
    but we scan attributes too (alt text, meta descriptions) via raw html."""
    html = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style.*?</style>", " ", html, flags=re.S | re.I)
    return html


print("== required files ==")
for rel in REQUIRED_FILES:
    check((ROOT / rel).is_file(), f"{rel} exists")

print("== page structure ==")
for rel in HTML_PAGES:
    p = ROOT / rel
    if not p.is_file():
        continue
    html = p.read_text(encoding="utf-8")
    check(re.search(r"<html\s+lang=", html), f"{rel}: <html lang> set")
    check("<title>" in html, f"{rel}: has <title>")
    check('name="description"' in html, f"{rel}: has meta description")
    check('name="viewport"' in html, f"{rel}: has viewport meta")
    check(html.count("<style>") == 1, f"{rel}: exactly one <style> block")
    check("favicon.svg" in html, f"{rel}: links favicon")
    check(TAGLINE in html, f"{rel}: carries the tagline")

print("== claims checklist (banned words) ==")
for rel in HTML_PAGES:
    p = ROOT / rel
    if not p.is_file():
        continue
    text = visible_text(p.read_text(encoding="utf-8"))
    for label, pat in BANNED_PATTERNS.items():
        check(
            not re.search(pat, text, flags=re.I),
            f"{rel}: no '{label}'",
        )

print("== no commerce, no secrets ==")
for rel in HTML_PAGES:
    p = ROOT / rel
    if not p.is_file():
        continue
    html = p.read_text(encoding="utf-8")
    check(not re.search(r"₹\s*\d", html), f"{rel}: no prices (commerce is Shopify-only)")
scan = [f for f in ROOT.rglob("*") if f.is_file() and ".git" not in f.parts]
for f in scan:
    try:
        content = f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError):
        continue
    rel = f.relative_to(ROOT)
    for label, pat in SECRET_PATTERNS.items():
        if str(rel) == "tests/test_site.py":
            continue
        check(not re.search(pat, content), f"{rel}: no {label}")

print("== internal links resolve ==")
for rel in HTML_PAGES:
    p = ROOT / rel
    if not p.is_file():
        continue
    html = p.read_text(encoding="utf-8")
    for attr, url in re.findall(r'(href|src)="([^"]+)"', html):
        if url.startswith(("http://", "https://", "mailto:", "tel:", "#", "data:")):
            continue
        path = url.split("#")[0].split("?")[0]
        if not path:
            continue
        target = (ROOT / path.lstrip("/")) if path.startswith("/") else (p.parent / path)
        if path.endswith("/"):
            target = target / "index.html"
        check(target.is_file(), f"{rel}: {url} resolves")

print("== launch list form ==")
index = (ROOT / "index.html").read_text(encoding="utf-8")
check('id="waitlist-form"' in index, "index.html: waitlist form present")
check('type="email"' in index, "index.html: email field present")
check('type="checkbox"' in index and "consent" in index, "index.html: DPDP consent checkbox present")
check("PARWAH_WAITLIST" in index, "index.html: backend config block present")
check("supabaseUrl" in index and "supabaseKey" in index, "index.html: Supabase config keys present")

# THE FORM MUST NEVER DEAD-END. Repo law says a form ships only when a real
# backend receives it. With the Supabase config empty, this page took a
# person's name, email and number and answered "the launch list is being
# connected right now" - the definition of a fake form, on the one element
# the whole site exists for. Every visitor converted to nothing.
story = (ROOT / "story/index.html").read_text(encoding="utf-8")
check("PARWAH_CONTACT" in index, "index.html: a fallback destination is configured")
_contact = re.search(r'PARWAH_CONTACT\s*=\s*\{[^}]*email:\s*"([^"]*)"', index)
check(bool(_contact and _contact.group(1).strip()),
      "index.html: the fallback address is not left blank")
check("mailto:" in index, "index.html: a signup with no database is handed to the mail client")
check("your email app is opening" in index,
      "index.html: and the person is told what is about to happen")
_supa = re.search(r'PARWAH_WAITLIST\s*=\s*\{[^}]*supabaseUrl:\s*"([^"]*)"', index)
_has_db = bool(_supa and _supa.group(1).strip())
check(_has_db or bool(_contact and _contact.group(1).strip()),
      "index.html: there is SOME way for a signup to reach a human")

print("== analytics and consent ==")
# DPDP wants a real choice, so nothing from Google may be fetched before one.
check("PARWAH_ANALYTICS" in index, "index.html: analytics config block present")
check("consent-bar" in index, "index.html: consent banner present")
check("localStorage.getItem(KEY)" in index, "index.html: the choice is remembered")
check(index.count("googletagmanager") == 1
      and "document.createElement(\"script\")" in index,
      "index.html: the tag is injected on consent, never hard-coded in the page")
_before_script = index.split("<script>")[0]
check("googletagmanager" not in _before_script,
      "index.html: no Google request is made before the visitor answers")
check('if (!PARWAH_ANALYTICS.ga4) return;' in index,
      "index.html: with no measurement ID, no banner and no request")
check("join_waitlist" in index, "index.html: joining the list is the tracked conversion")
check("anonymize_ip" in index, "index.html: IP anonymisation is on")

print("== share cards ==")
for _page, _img in ((index, "og.png"), (story, "og-story.png")):
    check('property="og:image"' in _page, f"{_img}: page declares a share image")
    check((ROOT / _img).exists(), f"{_img}: the image exists")
    check('name="twitter:card"' in _page, f"{_img}: twitter card declared")
for _img in ("og.png", "og-story.png"):
    _p = ROOT / _img
    if _p.exists():
        _b = _p.read_bytes()
        # PNG IHDR carries width and height as big-endian 32-bit ints at 16..24
        _w = int.from_bytes(_b[16:20], "big"); _h = int.from_bytes(_b[20:24], "big")
        check((_w, _h) == (1200, 630), f"{_img}: is 1200x630 ({_w}x{_h})")
        check(len(_b) < 1_000_000, f"{_img}: under 1MB ({len(_b)//1024}KB)")
check('rel="canonical"' in index and 'rel="canonical"' in story,
      "both pages: canonical URL declared")

print("== the phone ==")
# The nav used to be display:none under 640px, which removed the only link
# to the launch list on the device most of this traffic arrives on.
check(".nav-links{display:none}" not in index and ".nav-links{display:none}" not in story,
      "both pages: the nav is not hidden outright on a phone")
check('.nav-links a[href="#join"]{display:none}' in index,
      "index.html: the phone nav keeps the story link and drops the duplicate CTA")
check('.nav-links a[href="/"]{display:none}' in story,
      "story: the phone nav keeps the launch-list link, which is the point of the page")
check("min-height:44px" in index, "index.html: the consent buttons are thumb-sized")
check((ROOT / "tests/browser.mjs").exists(),
      "there is a browser suite that drives the page, not just reads it")

migration = (ROOT / "supabase/migrations/0001_waitlist.sql").read_text(encoding="utf-8")
check("enable row level security" in migration, "migration: RLS enabled")
check("for insert" in migration and "to anon" in migration, "migration: anon insert-only policy")

print()
if failures:
    print(f"{len(failures)} FAILURE(S):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All checks green.")
