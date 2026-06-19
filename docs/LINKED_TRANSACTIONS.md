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
`sipAllottedAmount`, `sipCharges`, `numberOfShares`, `paymentSourceAccountId`) and writes
the derived values onto the linked children.

For **child → parent** edits, two mechanisms keep things in sync:
1. **Leg children** (Transfer / CC Payment / NCMC / SIP / Stocks / Commodity) carry the
   same category + investment fields, and `openEditModal()` reconstructs
   `paymentSourceAccountId` from the counterpart, so the same forward loop produces a
   correct write back to the parent.
2. **Reward children** (instant cashback, reward-split) do **not** fit the leg model, so
   they have **dedicated reverse-propagation branches** and are explicitly excluded from
   the forward loop (which would otherwise corrupt the parent).

`openEditModal()` deliberately does **not** reconstruct `paymentSourceAccountId` for
reward/cashback children — they reciprocate via the reverse branches, not the leg path.

---

## Verdict per combination

| Link type | Edit parent → child | Edit child → parent | Delete (either side) |
|---|---|---|---|
| **Instant Cashback** | ✅ | ✅ child amount → parent `rewardEarned` (+ account) | ✅ deleting child resets parent `rewardEarned`; deleting parent removes child |
| **Reward Split** (CC-Payment, 3-leg) | ✅ (card = anchor; bank leg absorbs) | ✅ **Option B** — edit reward or bank leg; card credit stays fixed, the other funding leg rebalances | ✅ delete **reward leg** → payment kept, un-split to fully bank-funded (bank = card total, split cleared). Delete **bank leg** or **card** → whole payment removed |
| **Transfer** | ✅ | ✅ 1:1 amount + date + account + description | ✅ deletes both legs |
| **CC Payment** | ✅ (incl. reward-split bank portion) | ✅ | ✅ deletes both legs |
| **SIP** | ✅ | ✅ allotted/charges/shares/amount/description | ✅ deletes both legs |
| **Stocks** | ✅ | ✅ allotted/charges/shares/amount/description | ✅ deletes both legs |
| **Commodity** | ✅ | ✅ 1:1 amount + shares + description | ✅ deletes both legs |
| **Debt ↔ Ledger** | n/a | ⚠️ **date only — by design** (amount is intentionally NOT synced) | ✅ deletes linked ledger / debt entry |

### Notes / intentional exceptions

- **Debt ↔ Ledger** only propagates **date** and **deletion** between the ledger
  transaction and the debt-ledger entry. Amount is intentionally **not** kept in sync —
  this is a deliberate design choice, not a bug. Do not "fix" it.
- **Reward split is CC-Payment-only and always 3-leg.** The "Split with Rewards?" UI only
  appears for `isCCPayment && paymentSourceAccountId && hasRewardsOrWallet`, so a split
  always produces: **card credit (parent)** + **bank debit** + **reward debit**. The
  creation code is generic enough to support other categories / a 2-leg shape, but no UI
  path triggers that today.
- **Reward-split amount semantics (Option B):** the **card credit (`parent.amount`) is the
  fixed anchor** — it's a real fact (you paid the card that amount), so the two funding legs
  must always sum to it. Editing the **reward leg** rebalances the **bank leg**
  (`bank = card − reward`); editing the **bank leg** rebalances the **reward leg**
  (`reward = card − bank`). `parent.rewardUsed` always tracks the reward leg. Negative
  results are clamped to 0.
- **Star topology on delete:** linked legs point at the parent, not at each other. The
  delete cascade therefore expands to the **full transitively-linked leg group** (categories
  in `LEG_CATS`) so deleting a leg of a 2-leg pair (or the card/bank leg of a 3-leg split)
  removes the whole group — never orphans a sibling. Cashback children stay outside
  `LEG_CATS`, so deleting a cashback child still only resets the parent's `rewardEarned`.
- **Reward-leg delete is special (asymmetric, by design):** deleting *only the reward leg*
  of a 3-leg split is handled BEFORE the leg-group cascade and does NOT remove the payment.
  It un-splits: the card credit stays, the **bank leg absorbs** the reward amount
  (`bank = card total`), and the parent's `rewardUsed` / `rewardUsedAccountId` are cleared.
  Deleting the **bank leg** or the **card** leg still removes the entire payment, since the
  bank leg is the real money movement.
- **Removal-block guard:** because reward/bank leg edits carry no (reward leg) or a
  reconstructed (bank leg) `paymentSourceAccountId`, `updateTransaction`'s "payment source
  removed → delete counterpart" branch is explicitly skipped for them
  (`!isRewardSplitChildEdit && !isRewardSplitBankEdit`). Without this guard, editing the
  reward leg would delete the card parent.

---

## Discriminators (how the code tells legs apart)

- **Cashback child:** `category === 'Cashback'`.
- **Reward-split child:** a linked parent `P` exists with
  `P.rewardUsedAccountId === child.accountId`. This works even when the child's category
  collides with a leg (e.g. the reward leg of a CC Payment is itself `'CC Payment'`).
- **Leg child (Transfer/CC/NCMC/SIP/Stocks/Commodity):** category matches one of those,
  and it is not a reward/cashback child.

---

## Fallback (not currently used)

If a future link type genuinely cannot reciprocate child → parent, the agreed fallback is
to **surface a warning and a red warning border on the parent ledger row** rather than
silently desync. As of this writing every combination above achieves real child → parent
sync (except the intentional Debt amount case), so no warning UI is wired up.
