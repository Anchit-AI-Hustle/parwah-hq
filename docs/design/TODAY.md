# What comes first on Today

Today is the screen a family opens most. After a family's review of the app (3 October
2026), the rule is: **track five things, not fifty.** Families already talk
on WhatsApp, so Parwah does not compete with chat. It holds what WhatsApp
cannot: the papers, the medicines, who is doing what, who is who, and the
card for an emergency.

A real example from that review: a car was in a brother's name, and the claim needed the
brother's Aadhaar, PAN and licence. Instead of calling and waiting for
photos on WhatsApp, they were downloaded from the brother's profile in
Parwah. That is the product.

Each candidate is scored on **utility**: how often a family needs it × what
is at stake when it is needed × whether WhatsApp already does it
(1 = WhatsApp does it fine, 3 = only Parwah does it).

## The five, in order

| # | Widget | How often | At stake | Only Parwah | Score | Why |
|---|---|---|---|---|---|---|
| 1 | Vault | 2 | 5 | 3 | 30 | Aadhaar, PAN, licence, policies, reports. Rarely needed, but when a claim, a bank or a hospital asks, it is everything, and WhatsApp loses them in the scroll. |
| 2 | Health | 3 | 5 | 2 | 30 | The elders' medicines and what each is for, blood groups, allergies, doctors. This is what Parwah will mostly be used for. Ties with the Vault; the Vault comes first because it is Parwah's clearest reason to exist. |
| 3 | To do | 4 | 4 | 1 | 16 | Refills, bills, appointments, with who is doing it and when it is done. A WhatsApp group can ask, but it cannot track who took it. |
| 4 | Family | 3 | 3 | 1 | 9 | Who is who, who checked in today, where everyone is if they share it. |

The fifth is the **emergency card**, the wide button under the tiles. It
works without internet, so it is never more than one tap away.

## Under More

These are kept, not deleted, and are one tap away under **More**: Chats,
Contacts & addresses, Suggested, Plans, Ekta, Muhurat, Payments, Games and
family coins.

## Removed from Today

- **"How are my people today?"**, the daily food or mood question. Families
  already chat about this on WhatsApp, and it made the app feel
  complicated. A parent's one-tap All is well and Pills taken stay, and
  check-ins still show on the family card.
- **"Your family"**, the list of each person and what is missing for them.
  It repeated the Family tile; it lives on the People screen.

## The screen, top to bottom

1. Alerts and offline notices, when they apply.
2. For a parent in senior mode: All is well, Pills taken, SOS.
3. The family header: name and today's status, one line - a header, not a
   poster.
4. The four tiles, in the order above, then the emergency card. The tiles
   show the family's real numbers (papers kept, medicines on file, what is
   due, who checked in), never a slogan.
5. The quick-add row - after the content, never before it. The screen
   leads with what the family keeps, not with empty forms.
6. More.
7. Set-up cards when they apply (how ready the family is, first steps,
   other families).

The same rule holds on every screen (owner, 2026-10-13): **content first,
forms last.** A screen opens on what the family has - the list, the people,
the papers - and the way to add more comes after it or behind a fold.
On Family that means: the people themselves, how ready they are, where
everyone is, and the tree last with its add-form folded.

## Navigation follows the same order

- **Phone tab bar:** Today, Vault, To do, Family. Chat stays off the bar:
  families already talk on WhatsApp; the vault is what WhatsApp cannot do.
- **Sidebar and menu:** Today, then the daily tools (Chat, Ask Ekta,
  Together), then the four records in utility order (Vault, Health &
  contacts, To do, Family), then under More: Notifications, The day,
  Profile. One name per place, the same on the tiles, the tab bar, the
  menu and the screen that opens.
- **Chat** is still one tap away, from New chat in the top bar and the
  menu.

The order is fixed rather than reshuffled by the app, because people find
things by where they are. The gate (`npm test`, "today:" and "order:")
fails if this order changes without this page changing with it.
