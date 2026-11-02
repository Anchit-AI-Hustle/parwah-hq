# Parwah launch assets

Everything for the launch, from the LinkedIn soft launch (Tue 3 Nov 2026) through Diwali (Sun 8 Nov), Bhai Dooj (Tue 10 Nov) and the NRI home-visit season (15 Dec to 15 Jan). This folder is never deployed (`.vercelignore`); the gate in `site/tests/test_site.py` scans every `.md`, `.html` and `.json` here, and every image's alt text in `alt.json`, for banned claims, voice words, monitoring phrases and dashes.

**Rules every asset follows:** free for families today, a Family Plan "coming later" with no date or amount; parents in charge, never "monitored"; SOS alerts the family and is not an emergency service; a medicine tick is a record, not advice; features that are being built are only ever called "coming this month"; no competitor is named; creator posts carry "Paid partnership with Parwah" in the caption itself; WhatsApp marketing needs an opt-in first. Spending, budgets and targets live in the plan, not here.

**Images** are rendered from HTML by `_render/render.mjs` (Mela tokens from `site/public/styles.css`, the site's three fonts in `_render/fonts/`, real app screens of an example family in `_render/screens/`). Re-render everything with:

```
PW_CHROMIUM=/opt/pw-browsers/chromium node marketing/_render/render.mjs
```

It prints the contrast of every text colour pair it uses (all pass WCAG AA; gradient headlines are large text) and fails if one does not.

---

## Index

| Asset | File | Size | Where it is used | When |
|-------|------|------|------------------|------|
| Founder launch post, first comment, reply bank | `linkedin/launch-post.md` | 229 words | Anchit's LinkedIn | Tue 3 Nov (backup Wed 4 Nov), 8:30 to 9:30am IST |
| Launch post image | `linkedin/launch-post-1200x1200.png` | 1200x1200 | With the launch post | Tue 3 Nov |
| Carousel, 7 slides | `linkedin/carousel/slide-1.png` to `slide-7.png` | 1080x1350 each | LinkedIn, Instagram carousel | Fri 6 Nov (or launch day instead of the image) |
| Carousel as one PDF | `linkedin/carousel/parwah-launch-carousel.pdf` | 7 pages | LinkedIn document post | Same as above |
| 4 follow-up posts | `linkedin/follow-ups.md` | 4 posts | Anchit's LinkedIn | Fri 6, Tue 10, Thu 12, Tue 17 Nov |
| Meta ad copy, headlines, targeting | `meta/ads.md` | 3 angles x (3 texts, 3 headlines, 2 descriptions) | Facebook and Instagram, Click to WhatsApp | Angles 1 and 2 from launch; angle 2 boost 7 to 10 Nov; angle 3 from 1 Dec to 10 Jan |
| Angle 1, the 11pm call | `meta/angle1-11pm-call-1080x1080.png`, `-1080x1350.png`, `-1080x1920.png` | feed, tall feed, Stories | Meta ads | From launch |
| Angle 2, siblings | `meta/angle2-siblings-1080x1080.png`, `-1080x1350.png`, `-1080x1920.png` | feed, tall feed, Stories | Meta ads, Bhai Dooj post | 7 to 10 Nov, then always-on |
| Angle 3, NRI home visit | `meta/angle3-nri-home-visit-1080x1080.png`, `-1080x1350.png`, `-1080x1920.png` | feed, tall feed, Stories | Meta ads (abroad), LinkedIn 17 Nov | 1 Dec to 10 Jan |
| Forward kit (EN, Hinglish, Hindi) | `whatsapp/forward-kit.md` | 6 messages + 2 captions | Personal WhatsApp, family groups | Diwali 5 to 8 Nov, Bhai Dooj 9 to 10 Nov |
| Diwali Status | `whatsapp/status-diwali-1080x1920.png` | 1080x1920 | WhatsApp Status | 5 to 8 Nov |
| Bhai Dooj Status | `whatsapp/status-bhai-dooj-1080x1920.png` | 1080x1920 | WhatsApp Status | 9 to 10 Nov |
| Welcome reply, opt-in, templates | `whatsapp/business-messages.md` | 1 greeting, 3 utility + 1 marketing template | WhatsApp Business | Set up before 3 Nov; submit templates for approval now |
| Personal launch note | `email/launch-week-personal-note.md` | 1 email | Anchit's email to friends and colleagues | Tue 3 Nov |
| Welcome sequence | `email/welcome-sequence.md` | 3 emails | Launch-list joiners who consented | Day 0, day 3, day 7 after joining |
| Creator brief | `creators/creator-brief.md` | 1 brief | Sent to creators who say yes | Outreach from 4 Nov; posts from Diwali and in December |
| Creator outreach DM | `creators/outreach-dm.md` | 3 messages | Instagram / LinkedIn DMs | From 4 Nov |
| HR one-pager (text) | `b2b/hr-caregiving-benefit.md` | 1 page | Email to HR leads | From mid Nov |
| HR one-pager (PDF) | `b2b/parwah-hr-caregiving-benefit.pdf` | A4, 1 page | Attachment / leave-behind | From mid Nov |
| HR one-pager (source) | `b2b/hr-one-pager.html` | A4 | Renders the PDF | Edit with the .md |
| RWA / senior-club session | `b2b/rwa-senior-club-session.md` | 45 min outline + invite (EN, Hindi) | Societies, senior clubs | Weekends from mid Nov; Lohri 13 Jan and Pongal 15 Jan gatherings |
| Store listings | `stores/listings.md` | Play + App Store text, counts checked | Play Console, App Store Connect | When Parwah is published to the stores |
| Store screenshots | `stores/screenshot-1-1080x1920.png` to `-6-` | 1080x1920 each | Store listings; also usable as Stories | Same |
| Press release | `press/press-release.md` | 1 release, [CITY] to fill | Email to media | Tue 3 Nov after 10am |
| Media list | `press/media-list.md` | 10 outlets by desk | Press outreach | 3 Nov, Diwali week, early Dec |
| Alt text for every image | `alt.json` | 25 entries | Paste into each platform's alt text field | Always |
| Public press kit page | `site/public/press/` (on the site) | logos SVG + PNG, 4 screenshots | https://parwah-hq.anchit-tandon.com/press/ | Live with the site |

Later moments (no assets yet, reuse the above): Lohri 13 Jan and Pongal 15 Jan (RWA sessions, WhatsApp marketing template for opted-in people), Holi 22 Mar 2027, Mother's Day 9 May 2027, Father's Day 20 Jun 2027.

---

## Link codes (attribution without a pixel)

Every link we share carries a `ref` code, and the site types that code into the WhatsApp message a visitor sends us ("Hi Parwah (LI1) - ..."). The launch-list form stores `utm_source`, `utm_medium`, `utm_campaign` and `ref` with the join. First touch wins for the browser tab. With no code, each page uses its own (WEL, STO, AIS, CAR, LAU, GET, PRS).

Pattern: `https://parwah-hq.anchit-tandon.com/<page>/?ref=<CODE>&utm_source=<source>&utm_medium=<medium>&utm_campaign=<campaign>`

| Code | Where | utm_source / medium / campaign |
|------|-------|-------------------------------|
| LI1 | LinkedIn launch post, first comment | linkedin / social / launch |
| LI2 | LinkedIn follow-up 1, feature spotlight | linkedin / social / spotlight |
| LI3 | LinkedIn follow-up 2, Bhai Dooj | linkedin / social / bhaidooj |
| LI4 | LinkedIn follow-up 3, consent-first | linkedin / social / consent |
| LI5 | LinkedIn follow-up 4, NRI season | linkedin / social / nri |
| FB1, FB2, FB3 | Meta ads, angles 1 to 3 (pre-filled WhatsApp text; or links if an ad sends to the site) | facebook / paid / angle1, angle2, angle3 |
| WAD, WAB | WhatsApp forwards, Diwali and Bhai Dooj | whatsapp / forward / diwali, bhaidooj |
| EM1 | Personal launch email | email / personal / launch |
| EW1, EW2, EW3 | Welcome emails 1 to 3 | email / welcome / w1, w2 (w2care), w3 |
| CR + initials | Each creator, for example CRAS | creator / instagram or youtube or linkedin / handle |
| RW1 | RWA and senior-club sessions | rwa / session / society name |
| HR1 | HR one-pager | hr / onepager / pilot |
| PR1 | Press release, press kit link | press / release / launch |

Codes are letters and digits only, 2 to 10 characters. Anything else in a link is stripped before it reaches the message or the database.
