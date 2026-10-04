# What comes first on Today

Today is the screen a family opens most. After Anshul's review (3 October
2026), the rule is: **track five things, not fifty.** Families already talk
on WhatsApp, so Parwah does not compete with chat. It holds what WhatsApp
cannot: the papers, the medicines, who is doing what, who is who, and the
card for an emergency.

His example: a car was in his brother's name, and the claim needed his
brother's Aadhaar, PAN and licence. Instead of calling and waiting for
photos on WhatsApp, he downloaded them from his brother's profile in
Parwah. That is the product.

Each candidate is scored on **utility**: how often a family needs it × what
is at stake when it is needed × whether WhatsApp already does it
(1 = WhatsApp does it fine, 3 = only Parwah does it).

## The five, in order

| # | Widget | How often | At stake | Only Parwah | Score | Why |
|---|---|---|---|---|---|---|
| 1 | Vault | 2 | 5 | 3 | 30 | Aadhaar, PAN, licence, policies, reports. Rarely needed, but when a claim, a bank or a hospital asks, it is everything, and WhatsApp loses them in the scroll. |
| 2 | Health | 3 | 5 | 2 | 30 | The elders' medicines and what each is for, blood groups, allergies, doctors. This is what Parwah will mostly be used for. Ties with the Vault; the Vault comes first because it is Parwah's clearest reason to exist. |
| 3 | Things to do | 4 | 4 | 1 | 16 | Refills, bills, appointments, with who is doing it and when it is done. A WhatsApp group can ask, but it cannot track who took it. |
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
2. The family card: name, today's status, Invite and Family call.
3. For a parent in senior mode: All is well, Pills taken, SOS.
4. The four tiles, in the order above, then the emergency card.
5. More.
6. Set-up cards when they apply (how ready the family is, first steps,
   other families).

## Navigation follows the same order

- **Phone tab bar:** Today, Vault, Care, People.
- **Sidebar and menu:** Today, Vault, Memory, Care, People, Chat,
  Notifications, Ekta, Together, The day, Profile.
- **Chat** is still one tap away, from the floating chat button and the
  menu.

The order is fixed rather than reshuffled by the app, because people find
things by where they are. The gate (`npm test`, "today:" and "order:")
fails if this order changes without this page changing with it.
