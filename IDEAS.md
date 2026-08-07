# IDEAS — Club Products & Revenue Exploration

Branch: `proto`. Idea stage only — no site changes from this file yet. Goal: explore
paid memberships and club product sales. Context: for-profit club with community
benefit projects, ~40+ monthly workshop attendance, target $50K+/yr within 2 years.

---

## 1. North-star framing

- Club is **for-profit** has dual mission: generate revenue AND deliver community
  benefit (education, networking, AI policy, talent pipeline).
- Products are two families:
  1. **Paid membership** — recurring, low-touch, benefits-based.
  2. **Advertising / promotions products** — events-centric, time-bound,
     "use/lose" consumption.
- Revenue targets: near-term from sponsorships + ad products; recurring base from
  memberships; upside from special events.

---

## 2. Paid membership tiers (proposal)

Anchor: `$50K+/yr within 2 years`. At current ~40+ attendance/mo, even a modest
first-year conversion (20–30 members) supports a sustainable base, not the full
target — memberships are the foundation, ad products + special events scale.

Tier shape (pricing agreed):

| Tier         | Price   | Core benefits                                                                                                    |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------- |
| **Student**  | $10/yr  | Basic-level benefits at discounted rate; for enrolled students. Same access as Basic, reduced price.             |
| **Basic**    | $120/yr | Event access, member profile, community, early-bird pricing on paid events/training.                             |
| **Pro**      | $300/yr | Everything in Basic + **directory listing** (contact card, services offered, rank/title), 1x ad slot eligibility |
| **Pro Plus** | $999/yr | Everything in Pro + recurring promotion placement in workshops/meetings, priority special-event access           |

Notes:

- **Organizers get free memberships** in exchange for running the club (revenue-
  neutral: they compensate via labor, not dues). Closest tier: Pro (or Pro Plus),
  granted gratis while actively organizing. Decouple "organizer-status" (earned,
  free) from "paid tier" — an organizer who wants Pro Plus-level ad benefits pays
  the difference or gets Pro Plus matched to their organizing level.
- Annual-only pricing across all tiers (quoted as annual rates). Consider a monthly
  convenience option at slight premium later if demand shows.
- Membership is the access gate for buying/using ad products (bundling idea below).
- Keep tiers few (4) — pricing clarity beats options sprawl.

---

## 3. Directory listing ("benefit" of Pro+ membership)

Purpose: members opt in to be listed on the site directory **as part of their
membership card/profile**. Drives value for professional members + organizers.

What's on the card/directory entry:

- **Contact card**: name, role, org, email/phone (opt-in), website, social links.
- **Services offered**: free-text list of services/products they sell or offer for
  hire — visible on card.
- **Member rank / title**: e.g. `Organizer`, `Professional Member`, `Founding Member`,
  `Specialist`, `Ambassador`. Tied to tier + tenure/contributions.
- Optional: avatar, bio, tags (already modelable in current `MemberFrontmatter`).

Ideas / open questions:

- Opt-in + privacy toggle per field (email/phone especially). Explicit consent for
  any service data shown publicly.
- "Services offered" is user-uploaded free text or validated list? Suggestion:
  free text with sensible length cap; considered member-authored content.
- Ranking scheme should be **derived, not all manual** — combos of active/paid,
  tenure, verified organizer status. Avoid letting anyone self-title to "Organizer".
- Ties into existing `content/members/*.md` + `MemberFrontmatter`. Directory could
  reuse/extend this with: `member-type` (enum?), `services`, `rank`, `listed`.
- Consider `listed: true|false` gate so free members aren't forced into directory.

---

## 4. Advertising products (club sales)

Family: event-centric promotions the club sells to businesses/members. **Default
terms are use/lose** — unused slide placements or announcement slots do NOT bank.

Products (draft):

1. **Slide placement** — logo/message shown during workshops & meetings in the
   deck rotation.
2. **Announcement slot / stage time** — timed speaking slot in a workshop/meeting
   to announce new product, open job, or talk up a company (brand recognition).
3. **Branded presence** — subtler recurring placement (banner in venue, listing,
   featured on site). Longer-running, less time-reactive than slots.

Use/lose mechanics to nail down:

- Sold per **specific event** (not flex-pool): buyer picks a dated workshop/meeting.
- If they miss the confirmed slot → forfeit. No credits rollover. (This is the
  stated model — keep hard, but allow rescheduling BEFORE an SLA cutoff, e.g.
  "reschedule ≥7 days out or it's burned".)
- Need a booking/confirmation mechanism so "use" is unambiguous and logged. This
  is the hard part — see open questions below.

---

## 5. Special events (beyond monthly workshops)

Separate, higher-ticket events (e.g. demo days, job fairs/recruiting mixers, product
launch showcases, talks w/ sponsors, hackathons, hiring days). Characteristics:

- **Own advertising products** — dedicated packages, higher price, own inventory
  (e.g. booth, demo slot, sponsored segment, meal/coffee sponsor, swag).
- **Top advertising packages INCLUDE participation in special events** — i.e. the
  flagship sponsorship/ad tiers bundle special-event presence, not just monthly
  workshop slots. This drives the big-ticket sales and guarantees audience
  concentration.
- Candidate recurring special-event formats (to pressure-test):
  - Hiring/product day (matches "new products / job openings" ad theme).
  - Monthly theme event with rotating sponsor.
  - Showcase/lightning-talk nights.

---

## 6. Bundling & packages (top-down)

Anchor high-value packages to hit revenue faster:

- **Top packages**: several special-event participation slots + workshop slide
  placements + announcements + directory/logo presence → single multi-thousand
  sale (parallels/supersedes current sponsor tiers).
- **Advertising add-on bundles** for Professional/Organizer members.
- Membership buys **eligibility**, packages buy **inventory**. Clean split:
  - Membership = recurring identity + access.
  - Ad packages = one-off time-bound inventory.
- Current `sponsors` concept (platinum/gold/silver tiers at `content/sponsors/`)
  likely merges into / is rebranded by this ad-product structure. Keep the sponsor
  tier ladder but re-map it onto ad-product inventory + special-event participation.

---

## 7. Organizer self-advertising

Club organizers get **their own talks + professional services advertised on their
membership card/profile** (part of their benefit). Rationale: organizers provide
recurring unpaid value; profile placement is their compensation and keeps the
directory rich.

- Reuses directory card (section 3) — organizer cards show talks + services.
- Distinct from sold ad inventory: organizer presence is membership benefit, not a
  purchased slot.
- Keep a guardrail so organizer placement doesn't crowd out paid advertisers (e.g.
  organizer card space vs. slide slots remain separate surfaces).

---

## 8. Revenue model math (target sanity check)

Target: `$50K+/yr by year 2`. Composition sketches:

- **Memberships**: with prices now set (Basic $120, Pro $300, Pro Plus $999, Student
  $10; organizers free). A plausible year-2 mix: ~60–80 Basic, ~15–25 Pro, 2–4 Pro
  Plus, ~20–30 Student → roughly $10K–20K/yr. Organizers at ~free do not add dues.
- **Ad products + sponsorships**: 6–10 deals/yr, $1K–8K avg → $15K–40K/yr.
- **Special events**: 4–6/yr, sponsored participation + tickets → $10K–30K/yr.

All conservative-ish bands; sum comfortably ≥ $50K with only partial attainment in
each — target is believable at current 40+ attendance IF ad-product sales pipeline
exists. ~40 attendees/mo is a reasonable base to convert ~30–50% of regular
professionals to Basic and a handful to Pro/Pro Plus; a single annual Pro Plus
($999) ≈ ten Students. Pro Plus + Pro/Pro Plus ad deals carry the high end.

Open gaps to close before building:

- Demand signals (survey current attendees: would they join at these prices?).
- How many orgs/members would buy ad slots per month (inventory demand).
- Special-event formats attendees actually want to pay for.
- Payments/fulfillment path (billing for memberships+ads, invoicing, booking system)

---

## 9. Open questions / decisions needed

1. **Pricing set** — Student $10, Basic $120, Pro $300, Pro Plus $999 (annual).
   Validate demand via survey; revisit monthly option if needed. Remaining open:
   **organizer free-membership tier level** — Pro for all organizers, or Pro Plus
   for lead organizers / by contribution?
2. **Free tier vs. all-paid** — should any site membership stay free? (Suggest: keep
   a free community tier, restrict directory listing + ad products to paid.)
3. **Directory opt-in & privacy** — default opt-in or opt-out? Field-level control?
4. **Use/lose enforcement** — how do we confirm a slot was used and log forfeits?
   Need an ops/booking mechanism before selling. Reschedule-window rule (e.g. 7 days).
5. **Self-asserted rank vs. earned** — who can claim "Organizer" / titles?
   (Note: organizers get free membership — so "Organizer" is an earned status
   conferring a free tier, not a purchasable title.)
6. **Sponsorship rebrand** — fold current `sponsors` tiers into ad-product packages?
7. **Payment provider + fulfillment** — recurring billing for memberships, invoices
   for ad deals, booking calendar for slots. What handles this (Stripe? manual + form?).
8. **Special events calendar** — which formats first, frequency, staffing.
9. **Legal/for-profit structure** — for-profit club selling ads + memberships; any
   tax/business-consumer implications, refund/cancellation policy for memberships,
   ad contracts/T&Cs.

---

## 10. Sequencing proposal (once ideas are agreed)

1. Validate pricing + demand (survey → quick decisions on remaining §9 items).
2. Content/model foundation: extend member schema (listed/services/rank) + a
   `products`/packages content type (new frontmatter). No UI first.
3. Directory listing surfacing on member profile (build on existing member pages).
4. Membership signup/eligibility + payment path.
5. Ad-product catalog page + booking mechanism (use/lose enforcement).
6. Special events with bundled top packages; fold sponsor tiers in.
7. Measurement: track members, ad fulfillment/loss rate, revenue vs. $50K target.
