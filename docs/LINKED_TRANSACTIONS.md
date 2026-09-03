# Linked (Parent ↔ Child) Transactions

This document is the source of truth for how **linked transaction legs** behave on
**edit** and **delete**, in **both directions** (editing the parent, and editing the
collapsed child). If you touch any of the code referenced below, re-read this file and
keep the matrix accurate.

**Code touchpoints (all carry a comment pointing here):**
- `src/FinanceContext.tsx` → `updateTransaction()` and `deleteTransaction()`
- `src/components/Transactions.tsx` → `handleSave()` (leg creation) and `openEditModal()` (counterpart reconstruction)

---

## How linking is stored

Links are **bidirectional in storage**:

- The **parent** (the entry the user logs in the modal — `mainTxId`) holds
  `linkedTransactionIds: [...all children]`.
- Each **child** (auto-generated counterpart) holds `linkedTransactionIds: [parentId]`.

Because both ends carry `linkedTransactionIds`, editing *either* side enters the
propagation logic. In the UI the child is rendered collapsed under the parent
(`txCounterpartsMap`), but it is a full `TransactionRow` with the **same**
`onEdit`/`onDelete` handlers — so the child is independently editable and deletable.

## The design: "parent is the source of truth"

The forward propagation loop in `updateTransaction()` is written assuming the edited tx
is the **parent**: it reads parent-only fields (`rewardEarned`, `rewardUsed`,
`allottedAmount`, `investmentCharges`, `numberOfShares`, `paymentSourceAccountId`) and writes
the derived values onto the linked children. (`rewardUsed` is read through
`rewardSplitTotal`/`getRewardSplits` — see "How a split is stored" below.)

For **child → parent** edits, two mechanisms keep things in sync:
1. **Leg children** (Transfer / CC Payment / NCMC / Mutual Funds / Stocks / Commodity) carry the
   same category + investment fields, and `openEditModal()` reconstructs
   `paymentSourceAccountId` from the counterpart, so the same forward loop produces a
   correct write back to the parent.
2. **Reward children** (instant cashback, reward-split) do **not** fit the leg model, so
   they have **dedicated reverse-propagation branches** and are explicitly excluded from
   the forward loop (which would otherwise corrupt the parent).

For a **reward-split** group, `openEditModal()` reconstructs the full split context so each leg
opens its own correct modal: the **bank leg** shows the total bill + the split (amount = the card
anchor's amount, so "Primary Account Debit" derives to the real bank portion) with the card in its
auto-credit picker; a **reward leg** shows the card in its auto-credit picker. Those reconstructed
anchor fields are for display only — `updateTransaction` strips them from the child on save
(`isRewardSplitBankEdit` clears the whole split via `withRewardSplits(tx, [])`;
`isRewardSplitChildEdit` clears `paymentSourceAccountId`) so the anchor never duplicates onto a
child. Cashback children still don't reconstruct `paymentSourceAccountId` — they reciprocate via the
reverse cashback branch.

## How a split is stored: one anchor, many sources

A split is a **list** of sources on the anchor, `rewardSplits: { accountId, amount, legId? }[]`, one
entry per reward account funding the row, each pointing at the leg it debits. The older pair of
fields is written beside it and still means what it always did — `rewardUsed` is the **total** across
sources (so `total − rewardUsed`, the Option-B rebalance and every stats sum kept working untouched)
and `rewardUsedAccountId` is the **first** source (so `!!rewardUsedAccountId`, the app's "this row
anchors a split" test, kept working too). `withRewardSplits()` is the only writer; it keeps all three
in step, and clearing a split drops `rewardSplits` rather than leaving `[]`.

**Read splits through the accessors in `utils`, never off the raw fields**: `getRewardSplits`,
`rewardSplitTotal`, `debitableRewardSplits`, `isRewardSourceOf`, `rewardSplitOfLeg`,
`rewardSplitIndexOfLeg`, `rewardLegIdsOf`. That is what lets a row logged before multi-source splits
(the legacy pair, no `rewardSplits`, no leg ids) and a three-wallet one read identically, with no
migration.

`legId` is what makes several legs on one anchor identifiable. With a single source, "which leg is
the redemption?" could be answered by the account the anchor pointed at; with two, that question has
no single answer, and matching on account alone would let two sibling sources trade legs when one is
swapped. Leg ids are absent on rows written before they existed, so **account matching stays as the
fallback** everywhere — that is exactly what `rewardSplitOfLeg` encodes. The form records ids for a
legacy split the first time it is re-saved.

**A one-time reward is a source like any other, leg included.** "Other" — a coupon, a voucher, a
scratch-card credit — has no account to draw from, but it still gets a redemption leg: `accountId`
holds `EXTERNAL_REWARD_SOURCE_ID`, which matches no account, so the leg is in no balance anywhere
(`calculateBalance` filters by account id, and nothing equals the sentinel). It used to create no leg
and existed only as a `₹40 REWARD` pill on the anchor, which meant nothing to expand, nothing to tap
through to the split panel, and a two-source split that listed one leg. Because it is now an ordinary
row it inherits everything: ledger grouping keeps it out of the parent slot, tapping it opens its
anchor at that source's card, it takes its share of a passive exclusion, and deleting it un-splits by
just that source. Two consequences worth knowing:
- Wherever a row's account is NAMED, the sentinel would print "Unknown" — `accountNameOf` in `utils`
  gives it "One-time reward" instead (the ledger row, the Insights by-account breakdown, the
  assistant's context).
- It counts toward spend stats like a points redemption does, for the same reason: the rupee value of
  what the reward paid for is part of what the purchase cost.
The `₹40 REWARD` pill survives only for splits written BEFORE this (an external source with no
`legId`), which have nothing to expand into; re-saving such a row builds the leg and retires the pill.

**How many sources?** As many as there are eligible reward accounts (plus "Other", once). Nothing
caps the count at two: the picker on each card offers only sources no other card is spending from,
so the accounts themselves are the ceiling. One source per account is enforced in `validate()` —
two cards on one account would produce two legs nothing could tell apart, and each card's balance
check would think the whole balance was its own to spend.

---

## Verdict per combination

| Link type | Edit parent → child | Edit child → parent | Delete (either side) |
|---|---|---|---|
| **Instant Cashback** | ✅ | ✅ child amount → parent `rewardEarned` (+ account) | ✅ deleting child resets parent `rewardEarned`; deleting parent removes child |
| **Reward Split** (CC-Payment, 3-leg or more) | ✅ (card = anchor; bank leg absorbs) | ✅ **Option B** — bank leg is editable and rebalances the rewards; a reward leg has **no editor of its own** (tapping it opens the anchor, at that source's card) | ✅ delete **one reward leg** → payment kept, un-split by that source only (bank absorbs its amount, the other sources stay). Delete **bank leg** or **card** → whole payment removed |
| **Transfer** | ✅ | ✅ 1:1 amount + date + account + description | ✅ deletes both legs |
| **CC Payment** | ✅ (incl. reward-split bank portion) | ✅ | ✅ deletes both legs |
| **Mutual Funds** | ✅ | ✅ allotted/charges/shares/amount/description | ✅ deletes both legs |
| **Stocks** | ✅ | ✅ allotted/charges/shares/amount/description | ✅ deletes both legs |
| **Commodity** | ✅ | ✅ 1:1 amount + shares + description | ✅ deletes both legs |
| **Debt ↔ Ledger** | n/a | ⚠️ **date only — by design** (amount is intentionally NOT synced) | ✅ deletes linked ledger / debt entry |

### Notes / intentional exceptions

- **Debt ↔ Ledger** only propagates **date** and **deletion** between the ledger
  transaction and the debt-ledger entry. Amount is intentionally **not** kept in sync —
  this is a deliberate design choice, not a bug. Do not "fix" it.
- **A split can name several reward sources, so a group is 2-leg, 3-leg or wider.** A ₹448 bill part
  paid with ₹50 of CRED coins and ₹36 of super.money is a 4-leg group: card credit + bank debit +
  two reward debits, one per wallet. Everything below that says "the reward leg" holds per source —
  each has its own leg, its own amount, its own unit, and its own row in the ledger's expanded
  group. The log form shows one card per source in a snapping carousel with pagination dots (`+`
  adds a source, `×` removes the one on screen, and the last one standing closes the panel).
- **Reward split covers any debit or CC Payment, so it is 3-leg *or* 2-leg.** "Split with
  Rewards?" appears whenever `canSplitWithRewards` holds — not an investment, either a CC
  Payment (from either POV) or an ordinary debit, and at least one reward account able to
  fund it. A CC Payment produces the 3-leg star (**card credit (parent)** + **bank debit** +
  **reward debit**); an ordinary purchase produces a 2-leg pair (**account debit (parent)** +
  **reward debit**), which the creation code always supported but no UI reached before.
- **A 2-leg split stores the reduced amount on its parent.** `handleSave` writes
  `total − rewardUsed` for a debit, so a ₹448 purchase split with ₹86 of rewards stores ₹362.
  The form's Amount field means the *full* price, so `openEditModal` adds `rewardUsed` back
  when reopening one (`isPlainSplitAnchor`). Without that, the panel reads back ₹276 and an
  untouched re-save subtracts the reward a second time. CC Payments are exempt: their anchor
  is the card leg, a credit, which already holds the full bill.
- **Which reward sources are counted in a unit, and which are plain rupees.** Two different
  questions, two predicates in `utils`, and conflating them is what made a wallet holding 500 Chips
  read as ₹500. `isPointsDenominated` asks whether the account keeps a **separate** points ledger
  beside its money — only a CARD does (`isCashbackEnabled && rewardType === 'points'`), and it is
  what decides which balance map is read and whether a leg is `isRewardTransaction`.
  `isUnitDenominated` asks whether a balance is **counted in a unit** — true for such a card, and
  also for a `rewards` wallet that names a `rewardUnit` with a rate — and it is what drives DISPLAY
  and ENTRY: the ₹ | PTS toggle, the picker's balance line, the account form's balance field.
  A wallet has one ledger, in rupees, so its redemption leg stays an ordinary rupee debit; only the
  figures shown to and typed by the user are converted (`rewardUnitBalance`, `formatRewardBalance`).
- **Points vs rupees: the leg is always rupees; the rate is applied when reading the points
  balance.** A card's own reward balance (Jupiter's Jewels, Edge Miles) is denominated in
  points — its opening figure and the `realized` amounts on confirmed cashback statements are
  point counts. A redemption leg is *not*: it is stored in rupees like every other transaction
  amount, because the ledger's day totals, the spend stats and the Insights charts all sum
  `amount` as money and know nothing about points. `calculateBalance`'s `isRewardPoints`
  branch converts at the single read boundary (`rupeesToRewardPoints`, keyed on
  `pointsConversionRate` — "how many points equal ₹1"). Storing a point count on the leg
  instead would make a ₹448 purchase show a ₹792 day total, and would require every
  aggregation in the app to learn about units. It also means splits logged before the
  conversion existed are read correctly with no migration.
  The **"Rewards Used" field** can be typed in either unit via the `₹ | PTS` toggle
  (points-denominated sources only — a rupee wallet like CRED coins has nothing to convert),
  but a split's stored `amount` is always the rupee value, since that is what `utils`' balance math
  and the Option-B rebalance below both operate on. The unit is **per source**: each card in the
  carousel carries its own, because a card's own Jewels and a CRED-coins wallet on the same split are
  counted in different things.
- **The card leg is always the anchor, regardless of logging direction.** Logged from
  Credit POV the card credit *is* the main tx, so it naturally holds the split (`rewardSplits` +
  the legacy pair) and links to every funding leg. Logged from Debit POV the card is the
  *counterpart*, so `handleSave` moves the anchor onto it (`anchorOnCounterpart`): the card
  counterpart carries the split + links to `[bank main, ...reward legs]`, each reward leg links
  to the card, and the bank main tx stays a plain funding child (no split at all). This makes
  both directions produce an identical star (card = hub), so edit reconstruction
  (`openEditModal`) and the Option-B rebalance below always see `card.amount` as the total.
  Without it, Debit POV would anchor on the bank leg (partial ₹148) and corrupt the rebalance.
- **A reward leg is never a parent row, and has no editor of its own.** Two consequences of it
  being purely derived (amount = its source's amount on the anchor, account = that source's account,
  description/category/date propagated down):
  1. **Ledger grouping** must not choose it as the group's parent row. Parent selection used to be
     `find(type === 'debit')`, which is ambiguous for a 2-leg split where both entries are debits on
     the same date — it resolved to whichever sorted first, so a leg with a lower `order` headed the
     group and the actual purchase collapsed underneath it. Reward legs are now filtered out of the
     candidate pool before the credit/debit preference is applied.
  2. **Tapping it opens the anchor** (`rewardSplitAnchorOf` in `Transactions.tsx`, which also returns
     WHICH source the tapped leg was), scrolled to the split panel and opened at that source's card,
     ringed — with several wallets on one anchor the panel alone would not say which redemption was
     tapped. There the redemption sits beside the total it came out of. An editor on the leg
     itself could only offer no-ops, restatements, or back-doors into the anchor — and it was the
     source of a real bug: as a CC-Payment DEBIT on a `rewards` account it fell outside the
     CC-Payment account filter, so its populated Account picker rendered as "Select an account".
     The **bank leg keeps its editor** — that one is real money leaving a real account.
  Both tests key off the anchor's own fields, NOT `isRewardTransaction`, which is only set when the
  reward source is points-denominated (a rupee wallet like CRED coins leaves it false). Both need the
  `p.id !== tx.id` guard: a card redeeming its OWN points has `leg.accountId === anchor.accountId`.
  `updateTransaction`'s reverse-propagation branch for reward-leg edits is deliberately left in
  place — unreachable from the UI now, but it is the safety net for any other caller.
- **Reward-split amount semantics (Option B):** the **card credit (`parent.amount`) is the
  fixed anchor** — it's a real fact (you paid the card that amount), so the funding legs
  must always sum to it. Editing a **reward leg** rebalances the **bank leg**
  (`bank = card − every reward source`), and only the edited source moves — a sibling wallet on the
  same split is left exactly as it was. Editing the **bank leg** rebalances the rewards
  (`reward total = card − bank`); with several sources the difference lands on the **last** one
  (`redistributeRewardSplits` in `utils`), cascading backwards only if it runs out of room, because
  the sources are held in the order they were added and the last is the one most recently tacked on.
  A source flexed to ₹0 has stopped funding anything, so its leg is deleted with it rather than
  lingering as a ₹0 row. `parent.rewardUsed` always tracks the sources' total. Negative results are
  clamped to 0.
- **Star topology on delete:** linked legs point at the parent, not at each other. The
  delete cascade therefore expands to the **full transitively-linked leg group** (categories
  in `LEG_CATS`) so deleting a leg of a 2-leg pair (or the card/bank leg of a 3-leg split)
  removes the whole group — never orphans a sibling. Cashback children stay outside
  `LEG_CATS`, so deleting a cashback child still only resets the parent's `rewardEarned`.
- **Reward-leg delete is special (asymmetric, by design):** deleting *only a reward leg*
  of a split is handled BEFORE the leg-group cascade and does NOT remove the payment.
  It un-splits by that source: the card credit stays, the **bank leg absorbs** what that source was
  paying (`bank = card total − the sources that remain`), and that entry drops off the anchor while
  its siblings stay. With one source that is the old behaviour exactly — the split is cleared and the
  bank carries the whole bill. Deleting the **bank leg** or the **card** leg still removes the entire
  payment, since the bank leg is the real money movement.
- **Removal-block guard:** because reward/bank leg edits carry no (reward leg) or a
  reconstructed (bank leg) `paymentSourceAccountId`, `updateTransaction`'s "payment source
  removed → delete counterpart" branch is explicitly skipped for them
  (`!isRewardSplitChildEdit && !isRewardSplitBankEdit`). Without this guard, editing the
  reward leg would delete the card parent.

---

## Discriminators (how the code tells legs apart)

- **Cashback child:** `category === 'Cashback'`.
- **Reward-split child:** a linked parent `P` exists for which `rewardSplitOfLeg(P, child)` returns
  a source — i.e. one of `P`'s splits names this row as its leg, or (legacy, no ids) sits on this
  row's account. This works even when the child's category collides with a leg (e.g. the reward leg
  of a CC Payment is itself `'CC Payment'`), and it is what tells the SECOND wallet's leg apart from
  a plain counterpart — the old single-field test (`P.rewardUsedAccountId === child.accountId`) could
  only ever recognise one source, and handed the other the anchor's own amount.
- **Leg child (Transfer/CC/NCMC/Mutual Funds/Stocks/Commodity):** category matches one of those,
  and it is not a reward/cashback child.

---

## Fallback (not currently used)

If a future link type genuinely cannot reciprocate child → parent, the agreed fallback is
to **surface a warning and a red warning border on the parent ledger row** rather than
silently desync. As of this writing every combination above achieves real child → parent
sync (except the intentional Debt amount case), so no warning UI is wired up.
