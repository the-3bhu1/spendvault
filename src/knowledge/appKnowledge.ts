// Static knowledge base for the "Ask Vault" in-app assistant.
//
// This is the GROUND TRUTH the model uses to answer "how does the app work" / "how do I…"
// questions WITHOUT guessing. The assistant runs as a remote API with no access to this repo at
// runtime, so anything the user might ask about app behaviour has to be written here. Keep it in
// sync when features change — a stale or incomplete doc is the main failure mode for a grounded
// assistant (an undocumented action gets the out-of-scope reply instead of a real answer).
//
// Plain prose (not JSON) so the model reads it cheaply.

import { APP_VERSION } from '../utils';

/** Where to send the user for anything outside the assistant's scope. */
export const CONTACT = 'tribhuvankomarla@gmail.com';

/** The fixed line the model must use for out-of-scope / ungroundable questions. */
export const OUT_OF_SCOPE_REPLY =
  `I can only help with SpendVault and the finances you've added in the app. ` +
  `For anything else, reach the creator at ${CONTACT}.`;

export const APP_KNOWLEDGE = `
SpendVault (${APP_VERSION}) is a private, offline-first personal finance tracker. All data lives
locally on the user's device (browser localStorage); nothing is on a server. Currency is Indian
Rupees (₹). The app is also packaged for Android/iOS via Capacitor.

# Navigation
- Bottom nav (4 icons): Home (Dashboard), Wallet (Accounts), Receipts (Transactions), Profile (Settings).
- The Dashboard shows this month's total spend and a spend-by-category ring, plus two plaques that
  open Cards (dues, statements, rewards) and Wealth (portfolio, assets, retirement). Anything deeper
  about spending — month-on-month change, trends, per-day averages, budgets, spend by account — is
  in Smart Insights.
- Top bar: "Ask Vault" (this assistant) and the Hub (grid) button.
- The Hub opens: Group Splits, Lending & Borrowing, Bills, and Smart Insights — the features with no
  tab and no plaque of their own. Rewards and Wealth are NOT in the Hub: Wealth is a Dashboard plaque
  and Rewards is a category inside Cards (also a Dashboard plaque).
- Feature tours: the first time you open Cards or Wealth from its Dashboard plaque, the first time you
  open a Hub feature, and at first launch, a one-time guided tour runs using temporary sample data,
  which is then cleared. Tours can't currently be replayed.

# Accounts
An account is any place money sits or is owed. Built-in types:
- bank_account, cash, debit_card, e_wallet — normal balances (a credit adds, a debit subtracts).
- credit_card — a debit (spend) INCREASES the outstanding balance; a credit (payment) reduces it.
  Credit cards have an optional credit limit field (displayed on the account card as "Card Limit").
- stocks / mutual_funds — investments; track invested value and units/shares and current value.
  These are the internal keys; in the Account Type picker the user SEES "Stocks" and "Mutual Funds",
  and the Accounts tab groups them under "Stocks & Investments" and "Mutual Funds". Always answer
  using those visible labels, not the internal keys. The mutual_funds type was previously labelled
  "SIPs" — it covers any mutual-fund holding, bought via SIP or lumpsum. If a user still calls it a
  "SIP account", they mean a Mutual Funds account.
- commodity — gold or silver, valued at a ₹/gram price (AI-estimated or a manual override).
- epf — Employee Provident Fund; tracks running EPF balance, monthly employer/employee credit breakdown,
  monthly accrued interest for current FY (credited on March 31st), and 1-year projections. Options
  include Statutory Wage Ceiling (₹15,000 cap) vs Actual Basic + DA. Requires a "Current Employer"
  name field.
  Changing your salary: edit the EPF account (Accounts → pencil) and change "Monthly Basic + DA
  Salary". There is no separate salary-history screen — the projection is anchored to a balance and a
  month rather than replayed from your joining date, so saving re-anchors it to the current month and
  every month from then on uses the new figure. The "Current Balance" field in that editor is
  pre-filled with the balance as projected TODAY, so re-anchoring keeps everything accrued so far;
  overwrite it only if your EPFO passbook says something different.
- rewards — a reward wallet (CRED coins, super.money, Cheq Chips). Give it a REWARD UNIT NAME and a
  POINTS-TO-₹1 RATE and the wallet is counted in that unit: the balance field is typed in it (500
  Chips, not ₹500), the Accounts card and the split picker show "500 Chips", and every rupee figure
  the wallet touches — a redemption, a cashback deposit, the Wealth total — is converted at the rate
  (10 Chips = ₹1, so 500 Chips is worth ₹50). Leave the unit blank and it is a plain rupee wallet.
  Unlike a card, a rewards wallet has ONE balance: it is not a points ledger sitting beside a rupee
  one, it is the same balance read in a different unit.
- offset — an Offset Ledger: a bookkeeping account for spending that never touched one of the user's
  own accounts, e.g. a share of a bill a friend paid, or a contribution funded by money someone owed
  them. Entries come in pairs (the spend as a debit, the money that funded it as a credit), so a
  settled ledger nets to zero and the spend still lands in the month's category totals. Shown in the
  Accounts tab under "Offset Ledgers" and LISTED under Wealth → Assets → Other, always at the bottom
  of that group, but NOT counted in the Assets total: its balance is a bookkeeping residue rather
  than money, and a pair still missing its other half would otherwise move the total by an amount no
  real balance ever changed by. The row is marked "Not in total", and a footnote under the list says
  how many offset ledgers were excluded. It is the ONLY kind of account excluded from that total.
Add or remove custom account types in Settings → Account Types (a type that's in use can't be deleted).
"offset" was a custom type in older versions and is built-in now; existing Offset Ledger accounts are
migrated automatically on upgrade, so it no longer appears in the custom list.
Actions (each account is a card on the Accounts tab):
- Add: Accounts tab → "+" → fill the form → save. For a stock/fund you can search its symbol while adding.
- Edit or archive: use the pencil (edit) and trash (archive) icon buttons on the account's card — there
  is no swipe gesture for accounts.
- Archiving is a soft-delete: the account is hidden from lists, pickers and balance/portfolio totals,
  but KEPT so old transactions still show its name (with a "deleted" badge) instead of "Unknown".
- Restore an archived account: Accounts tab → the "Archived" section at the bottom of the list → Restore.
- View statement (credit cards): the "Statement" button on the card opens it here; tapping the card's
  cycle in Cards → Statements opens the same statement as a full screen in
  that tree. Either way a cycle picker switches between past and current billing cycles, and
  long-pressing a spend moves it to the neighbouring statement — see "Credit cards & billing cycles".
- View saved card details: the "Card" button flips the card to reveal number/expiry/CVV; tap a field to
  copy it. A Share button on that view copies the full details (card name, cardholder, number, expiry,
  CVV) to the clipboard AND opens the OS share sheet, so they can be sent to any app.
- Save or change card details: in the account's add/edit form, the "Card Details (Optional)" block —
  "+" to start, pencil to edit, ✓ to save, trash to remove. It holds cardholder name, card number,
  expiry, CVV, network (Visa/Mastercard/RuPay/Amex/Diners) and issuing bank; the bank is a search
  field, and if left blank it is inferred from the card's name. Stored on-device, behind the app PIN.
- No card field is required and a partial card is fine (e.g. number and name but no CVV), but a field
  that IS filled must be valid: a 16-digit number (15 for Amex), a 3-digit CVV (4 for Amex), and an
  expiry with BOTH month and year, month 01–12. Saving is blocked until a filled field is valid.
- Send to Bank: rewards and e-wallet accounts have a "Send to Bank" button that transfers their full
  balance to a bank account (in rupees — a wallet counted in a unit sends what that unit is worth).
- Refresh a holding's price: stock/fund/commodity cards have a per-holding Fetch/Refresh button.
Opening balances are stored per month ('YYYY-MM'); editing one applies from that month forward.

# Transactions
Fields: date, description, account, type (credit/debit), amount, category. Optional: tags, a
recurring flag, exclude-from-stats, and links to auto-generated counterpart legs.
Actions (Transactions tab):
- Add: tap "+", fill details, save.
- Edit: tap a transaction row (a quick tap) to open its editor.
- Delete: swipe the row to the RIGHT until the red DELETE appears, then release. Deleting also
  removes any linked counterpart legs.
- Reorder: long-press a row and drag up/down. Reordering works only WITHIN the same date and moves a
  linked transaction together with its counterpart legs as a block. Dragging while a filter or search
  is active reorders only the rows you can see, among the positions those rows already occupy —
  anything the filter is hiding keeps its place in the day, so clearing the filter never reveals a
  day that has been shuffled behind your back.
- Filter/search: use the Filters panel in the Transactions tab to search and filter by type, account,
  category, tag, or month (with removable filter chips and income/spend summaries).
  - Selecting the "Investments" category reveals an extra "Investment Type" filter (Mutual Funds /
    Stocks / Commodity), so you can narrow to just fund purchases or just gold buys. It disappears
    and resets when Investments is deselected, and it only constrains investment rows — filtering by
    type alongside other categories leaves those other categories' transactions untouched.
- Exclude from stats: this control appears in the editor only after you enable Settings → Smart
  Features → Passive Logs. You can exclude a transaction fully, or a partial amount; Dashboard and
  Insights then skip that amount. The two boxes (Excluded Amount / Active Share) add up to the FULL
  price of the entry, rewards included. On a reward split the exclusion is stored across every leg —
  a ₹448 purchase paid with ₹86 of rewards can exclude the whole ₹448, which excludes ₹362 on the
  purchase and ₹86 on the reward leg, so the purchase contributes ₹0 to Spends. Exclude a smaller
  figure and the primary account's portion absorbs it first (₹400 excluded = ₹362 + ₹38).
- Tag: in the editor, type a #tag. There are two tag types:
  - **Active tags** (shown by default in the tag picker dropdown) — for recurring tags like #food or #worktrip.
  - **Event / One-off tags** (hidden from the dropdown by default, but searchable when typing) — for
    infrequent or one-time events (e.g. a trip or special occasion). When creating a tag in the
    transaction editor, a toggle button switches between "Active" and "Event" target. Both types are
    stored in the same \`tags\` field on the transaction.
  Manage both types in Settings → Tags (two separate sections: "Active Tags" and "Event / One-off Tags");
  you can move a tag between types there (arrow icon), rename, or delete it.
  Renaming a tag to a name that already exists MERGES the two — every transaction carrying the old
  tag is rewritten to the existing one — so a rename is also how you fold a duplicate tag away.
  Deleting a tag removes it from all its transactions.

# Auto-generated (linked) transactions — what creates a child log
Several actions create paired/child transactions, linked together (linkedTransactionIds). Editing or
deleting one keeps the legs in sync / removes them together. By category:
- Transfer: moving money between two accounts. Creates a debit on the source and a credit on the
  destination (descriptions "Transfer to/from <account>"). The two sides are the same figure by
  default; a toggle under the account picker ("Same amount" / "Custom amount") lets the far side
  state its own. Use it when a platform sells balance at a discount (pay ₹180 from the bank for a
  ₹200 gift-card load — the wallet is credited ₹200) or when a rail charges a fee (send ₹200, ₹197
  lands). The difference is not income or a spend: transfers are a system category either way.
- CC Payment: paying a credit card from a bank/payment account. Creates a debit on the paying account
  and a credit on the card (reducing its outstanding). The card credit is applied to the chosen
  billing cycle (current or previous statement).
  - With a reward split: if reward points are used toward the payment, a THIRD leg debits the rewards
    account for the points used and the bank leg covers the rest — and a fourth leg, and so on, if the
    payment draws on more than one reward source.
  - Which accounts can be used: the "Paid from" picker is grouped under account-type headings and
    offers three kinds, all of them unconditionally.
    (1) Standalone "rewards" wallets, whether counted in rupees (CRED coins) or in their own unit
    (Cheq Chips at 10 = ₹1 — the picker shows "500 Chips" and the ₹ | PTS toggle appears).
    (2) E-WALLETS — a Flipkart, Amazon Pay, AJIO or Uber balance and the like. A purchase part-paid
    from stored value is therefore ONE entry with two legs, not two unrelated entries: the wallet's
    leg is an ordinary rupee debit, so that wallet's balance drops by exactly what it paid, and the
    spend is still counted once (loading the wallet was a Transfer, which is excluded from stats).
    (3) Any card carrying its own points ledger (Jupiter's Jewels) — offered whatever account the
    payment itself is charged to, so a card's points can be put toward a purchase made on a different
    card or straight from a bank. The points always come out of that card's OWN points ledger and its
    rupee/credit balance is untouched. Most issuers only let their points offset their own bill; the
    app records what you tell it and does not enforce that rule.
    Physical cash is deliberately NOT a source — a cash purchase has no second leg to reconcile.
    There is no "None" entry in the picker: the panel's "×" is how you abandon a split, and it clears
    the amount and the source together. Switching category (or investment type) clears an in-progress
    split.
  - The split panel and "Apply Payment To" cycle picker appear as soon as the category is CC Payment —
    you don't have to pick the paying account first.

"Split Payment" is NOT limited to CC Payments — it appears on ANY ordinary debit (a purchase,
a bill, a recharge). Investments are the only exclusion. It does not require owning a reward account:
the "Other" source below covers one-off rewards.
- On an ordinary purchase the split is a PAIR of entries, not three: the chosen account is debited for
  the part you actually paid, and a second leg debits the reward source for the rest. The Amount field
  always means the FULL price — the panel shows the derived "Primary Account Debit" underneath, and
  reopening the entry shows the full price again, not the reduced figure.
- SEVERAL reward sources on one payment: once a source is picked and given an amount, a "+" appears
  beside the panel's "×" and adds another card. The cards slide sideways (swipe, or tap a pagination
  dot underneath) and each carries its own "Amount" field, its own "Paid from" picker and its own
  unit — so a ₹448 bill can be part-paid with ₹50 of CRED coins AND ₹36 of super.money at once. How
  many is not fixed at two: every eligible reward account can be a card, and a source already used by
  another card drops out of the other pickers, so one account is only ever spent from once per
  payment ("Other" likewise appears once). The "Primary Account Debit" line underneath always shows
  the full price minus every source together, and the save is refused if the sources together exceed
  the price. Each source produces its OWN debit leg, so a two-wallet split lists two redemptions under
  the spend in the ledger, and the "×" removes only the card on screen (the last one closes the panel).
- Unit toggle (₹ | PTS): when the source is a card's own points wallet, the "Amount" field
  can be typed in either unit and a "= ..." line underneath shows the converted value. It always
  STARTS in ₹, including after picking a points wallet — picking a source never re-reads digits
  already typed as points. PTS is only ever reached by tapping the toggle, and that choice then
  sticks for that card. Typing 430 in
  PTS mode and typing 86 in ₹ mode are the same redemption when the rate is 5 Jewels = ₹1 — pick
  whichever the issuer's app showed you. A rupee-denominated rewards wallet has nothing to convert, so
  it shows no toggle. The conversion rate is set per account (Accounts → edit the card → reward unit
  and conversion rate).
- Redeeming more than the wallet holds is refused on save, and the message names what IS available in
  that account's own unit (e.g. "Only 432 Jewels available"). Editing an existing split can always be
  re-saved or lowered — its own already-recorded redemption counts as available.
- "Other" (last option in the "Paid from" picker, under its own "No Account" heading) is for a
  ONE-TIME reward that isn't worth its own
  account — a coupon, a voucher, a scratch-card credit, a referral discount. It behaves like any other
  source: the Amount field is the full price, the primary account is debited for the rest, and the
  reward gets its OWN entry in the ledger, collapsed under the spend like any redemption ("One-time
  reward" where the entry would name an account). What makes it different is that it draws on nothing
  — no reward balance anywhere is deducted, so nothing has to be set up first — and because there is
  no balance behind it the "Only ... available" check doesn't apply; the transaction total is the only
  limit. Use a real rewards account instead when the source is a wallet with a running balance worth
  tracking (CRED coins, super.money, a card's own points).
  Splits logged before one-time rewards got their own entry show a small "₹40 REWARD" pill beside the
  category instead; re-saving such an entry replaces the pill with the ledger entry.
- In the ledger a part-paid purchase leads with WHAT IT COST, not with what this account lent. A
  ₹187 order paid with ₹106 of credit and ₹81 of wallet money shows a bold −₹187 as the row's
  headline, with a small grey ₹106 on the line below it — level with the account name, so the two
  read across as "Jupiter x CSB … ₹106". The remaining ₹81 is the collapsed leg. So all three
  figures are reachable: the price at a glance, the card's share beside the card, and the wallet's
  share on expanding.
  This applies ONLY to a part-paid purchase. A plain purchase shows its single amount as always, and
  a linked pair that is NOT a split (a transfer, a CC payment, an investment) never gets a combined
  figure — its two legs are the same money counted twice and adding them would double it.
  The source's leg is collapsed under the row as a linked
  entry ("Part-paid with rewards", or "Funding + rewards" on a CC Payment). That toggle says
  "rewards" whatever the source was, so it reads that way for an e-wallet leg too. Each leg is named
  "Paid toward: <the spend's description>" (on a CC Payment, "Paid toward: <the card>"). Two sources
  are listed as two separate entries in there, and the toggle counts them ("Part-paid with 2
  rewards", "Funding + 2 rewards"). Inside an expanded group the legs are ordered: the primary account's own
  leg first, then the reward redemptions largest-first by rupee value (so a 500-Chip redemption worth
  ₹50 outranks a ₹10 coupon), and any instant-cashback credit last — the legs above it add up to the
  row's total, which cashback is not part of.
  Tapping a redemption opens the spend it belongs to, with the split panel in view and that source's
  card ringed — the amount redeemed is edited there, next to the full price. Deleting it un-splits
  instead: the payment stays and the primary account absorbs that source's portion, while any other
  source keeps funding its own share.
- A redemption is NOT a charge on the card. It never appears on the card's statement, in its
  outstanding balance, or in its billed/unbilled dues — those count only what the credit line actually
  lent. So a ₹448 purchase paid with ₹362 of credit and ₹86 worth of points shows ₹362 on the
  statement, and the points balance drops instead. The redemption is visible in the ledger, as the
  linked entry under the spend.
- Reward points are always tracked in the account's own unit — a card's points wallet and a rewards
  wallet that names a unit alike — while the ledger, spending totals and Insights charts count the
  RUPEE value of what the points paid for. So a ₹448 purchase split with 430
  Jewels still shows as ₹448 of spending, and the Jewels balance drops by 430.
- Investments: logging an investment purchase. Credits the investment account with the
  holdings/units/grams and debits the paying bank account for the cost (+ charges). Legacy categories
  ("Mutual Funds", "Stocks", "Commodity", "SIP") are consolidated under "Investments".
  - Picking "Investments" reveals an "Investment Type" sub-picker — Mutual Funds, Stocks or Commodity
    — which drives the rest of the form. Each type has its own fields and its own valid accounts:
    - Mutual Funds: Allotted Amount + Stamp Duty/Charges + Units Allotted; pairs with a Mutual Funds account.
    - Stocks: Invested Amount + Brokerage/Taxes + No. of Shares (required); pairs with a Stocks account.
    - Commodity: a single gross amount + Grams (required); pairs with a Commodity (digital gold/silver)
      account. Commodity has no invested-vs-charges split.
    The transaction is described automatically after the holding account (e.g. the fund or stock name),
    and switching type clears any account or quantity that no longer applies.
- Cashback (instant): on a debit with instant cashback, an extra credit posts to the chosen rewards
  account (category "Cashback"). Offered on ANY debit from a bank or e-wallet — including transfers,
  card bill payments and NCMC recharges — because it is the payment app (super.money, CRED, …) that
  rebates the payer, whatever the money was for. It needs a rewards/e-wallet account to deposit into.
  Card cashback is the other kind: paid by the issuer for spending on the card, so it is NOT offered
  on transfers, CC payments, NCMC recharges or fund purchases.
- Cashback (delayed): see Rewards — confirming realized cashback posts a "Cashback" credit
  into the chosen account.
- NCMC Travel Recharge: on an NCMC-enabled debit card, moves money from the card's payments balance
  into its separate travel balance (and travel purchases draw it back down).

# Categories & Budgets
Spending is grouped by category. Add, delete and reorder categories in Settings → Categories (drag a
row by its handle to reorder; "Other/Misc" always stays last). Set or change a monthly ₹ budget per
category in the Insights screen (not Settings), which shows actual-vs-budget progress. Deleting a
category leaves existing transactions with their old category text.
"Fuel" is a standard spend category (with its own fuel-pump icon) and is auto-added just after "Rent"
for existing users on upgrade, so it may appear without you creating it.
"Fund" is a standard spend category (piggy-bank icon), auto-added just above "Fuel" on upgrade. It is
for contributions to a pooled/committee fund — a real spend, NOT stats-excluded, so it counts toward
Spends and can carry a monthly budget. Use it when a contribution is settled by offsetting someone's
debt instead of paying cash: log the offset as a repayment in the Debt ledger (which moves the account
balance but counts as neither Spend nor Income) plus a Fund debit on the same account and date, so the
account nets to zero and the contribution still shows in that month's Spends. An Offset Ledger account
(type 'offset') is the account to use for that pair when no real account of yours was touched.
System categories (internal bookkeeping, EXCLUDED from spend totals so transfers/payments/investments
don't look like spending): Transfer, CC Payment, NCMC Travel Recharge, Investments, and
Lending & Borrowing. Lending & Borrowing is auto-excluded from both Spends and Income everywhere
(Dashboard, Insights, Ask Vault) because money lent out or borrowed is expected to be returned — it's
not a real spend or income. The "Cashback" category is a credit (income into a rewards/account), not spend.

# Credit cards & billing cycles
A card has a statement day and a due day.
- Statement day: the day the cycle closes. A transaction dated ON or AFTER the statement day rolls
  into NEXT month's statement; before it, it stays in the CURRENT one.
- Billed = the most recently generated statement (what's due). Unbilled = the cycle in progress.
- A statement left unpaid when the NEXT one is cut does not disappear: it stays in the card's
  outstanding balance and in its credit utilisation as arrears, named by the month it came from, and
  the Bills row for that card shows it in a red band above the current statement.
- Due day: shown for reference (when payment is due); it does not lock anything.
- Rounding rule (round/floor/ceil/none) is applied to the BILL — spend less credits that adjust what
  you were charged (cashback paid in rupees, refunds, reversals) — and payments are then subtracted
  from that rounded figure. That is the order a bank uses: it prints ₹1,538 and you clear it by
  paying ₹1,538, so the paise the rounding dropped must not come back as a balance.
- A residue of ₹1 or less left behind by that rounding is NOT called arrears — a statement is
  rounded and the payment against it is not, so a rupee is noise rather than a debt. It is still
  COUNTED: it stays in the card's outstanding balance (shown under Billed, since it is money on a
  statement that was cut) and simply never triggers an overdue badge, band or status. The proper fix
  for a cycle whose figure disagrees with the bank is to correct it outright (see below), which
  drives the residue to zero.
- Correcting a statement by hand: on the statement screen, LONG-PRESS the big Statement Amount
  figure. A "Statement Amount" sheet opens showing the month, its date range and the app's
  "Calculated:" figure; type what your bank actually printed and press "Save statement amount".
  Banks do not always round the way they say they do, and the printed bill wins. It changes THAT
  cycle only — every other cycle keeps following the card's rounding rule — and once set the sheet
  offers "Reset to <calculated figure>" to drop the override again.
- Where a statement stands is said in one word, the same word on the Statements list and on the
  statement screen: "Nothing billed" (an unused month), "Overdue", "Overpaid" (more was paid against
  it than it billed — the money sits as credit on the card), "Settled", "Partially paid", "Unpaid",
  and "Open" for the cycle still running. Overdue outranks partially paid, and overpaid outranks
  settled, so the row always shows the stronger of two true statements.
- Which statement a credit lands on: only a CC PAYMENT gets to choose. Logging one shows "Apply
  Payment To" — Previous Statement (reduce already-billed dues) or Current Open Cycle (an early
  payment against the cycle in progress). Every OTHER credit on a card — a merchant refund, a
  reversal, a cashback credit — simply falls in the cycle its own date belongs to, exactly like a
  spend does. So a refund dated the 12th appears on the statement covering the 12th.
- Settlement lag (an entry near the cut landing on the NEXT statement): banks bill by POSTING date,
  not the date you spent. A card swipe is an authorisation; the charge posts when the merchant
  submits its batch, often 1–3 days later, and e-commerce is the slowest (an Amazon order can post
  on dispatch). Refunds are slower still — the merchant raises one, then the network settles it. So
  an entry a day or two before the statement day may be billed a month later than the app assumes —
  the real statement shows it as "yet to be settled".
  - The app flags this instead of guessing: on either statement surface, an entry dated within 3 days
    of the cut carries a dashed "MAY SETTLE NEXT" tag. There are two such surfaces and they behave
    identically: the statement opened by the "Statement" button on the Accounts tab, and the statement
    screen inside Cards (Statements → a cycle).
  - To correct it: LONG-PRESS that entry in the statement's transaction list. A sheet offers "Move
    to <next month> statement", "Move to <previous month> statement", and (once moved) "Reset to
    transaction date". An undo appears for a few seconds after each move.
  - Spends AND refunds/reversals can be moved, but only to the month either side of the one their
    own date puts them in — moving repeatedly cannot push an entry further than one month out.
  - Two kinds are excluded — not long-pressable, and never tagged — because their cycle is decided
    rather than observed: CC PAYMENTS (which choose theirs through "Apply Payment To" when logged)
    and CASHBACK credits (generated to the card's own same-cycle/next-cycle policy).
  - A moved entry is tagged "FROM <month>" on the statement it lands on, and the move applies
    everywhere at once: the statement, the card's outstanding balance, and the bill reminder.
# Cards (the Dashboard's Cards plaque)
The home screen shows total outstanding across every live card — billed, unbilled, credit utilisation
against the cards' limits, and which card's bill lands soonest — then up to three categories:
1. **My Cards** — one tile per card, painted in that card's own colours, showing what it owes and
   when its bill is due. A card at ₹0 keeps its tile; its statement and due dates are still
   information. Each tile carries ONE date line, and which one says whether there is a bill to pay:
   - "Due 4th · in 2 days" — this card has a BILLED statement outstanding. The date is the payment
     due date, and the phrase after it counts down to it ("Due today", "Overdue by 3 days").
   - "Statement 5th" — nothing is billed yet. The whole figure on the tile is still accruing on the
     OPEN cycle, so there is no bill and a due date would be a date with nothing behind it. The 5th
     is the card's statement day: the day the cycle closes, that amount becomes billed, and the tile
     switches to a "Due …" line. It is always the NEXT occurrence of that day, and the figure can
     still change until then, because anything spent before the 5th joins the same cycle.
   So a card showing "Statement …" is not part of the bill-due banner's count either — that banner
   counts billed statements, and this card has none.
   Cards are listed in WALLET ORDER — the same order as the Accounts tab, the order they were added —
   not by whose bill falls due first, so a card sits in the same position on every screen that names
   it. (Bills and the bill-due banner still rank by urgency: those two ARE lists of what falls due
   next.) The hero above them leads with the combined credit limit and the number of cards held — or,
   when no card has a limit recorded, with total outstanding and which card owes it — then two
   figures: "LTF", how many of the cards are LIFETIME FREE, as a COUNT ("All", "None", or "2 of 5")
   and not a rupee fee total; and "Earned", what the wallet has earned back all-time. A card with no
   annual fee recorded counts as lifetime free. What one card costs, and how far its waiver has got,
   is on that card's own summary screen — the hero deliberately doesn't sum fees, because a total
   across the wallet doesn't say whether the next renewal charges you.
2. **Statements** — every cycle that has already been CUT, newest first, with the statement amount and
   how many entries are on it. The cycle in progress is deliberately absent: it has no printed
   statement and its figure moves with every charge, which is what My Cards is for. The hero total
   is the sum of what's listed, so filtering to one card narrows it too.
3. **Rewards** — the cashback vault (see "Cashback / Rewards"). The category row shows a COUNT of
   rewards awaiting credit, not a rupee figure, because cards can pay in different units.
Tapping a tile in My Cards opens that card's SUMMARY SCREEN — the card as a whole rather than any one
month: its name, network and last four digits, its outstanding with the billed/unbilled split, credit
utilisation and when the bill is due; a "View card" button that opens the rotatable card; what the card
costs to hold; how far this membership year's spend has got toward a fee waiver, if it has one; and
what the card has been spent and earned back, this year and all-time.

Tapping a cycle in Statements opens that card's STATEMENT SCREEN instead: month pills for its recent
cycles, the selected cycle's date range labelled "Open cycle" or "Closed statement", that cycle's
spends / credits / statement total, and its full ledger. Long-press any entry there to move it between
statements; long-press the statement AMOUNT to correct the figure by hand when the printed bill and the
derived one disagree (a sheet offers the typed figure, and "Reset" hands the cycle back to the card's
rounding rule). A corrected cycle says so on screen.
Archived cards are excluded from all of this, as they are from balances everywhere else.

## What a card costs to hold
A credit card's fees are set when adding or editing it on the Accounts tab. "Card Fees" is a picker
with three shapes — Lifetime free, Annual fee, or Joining + annual fee — and only the amounts that
shape implies are asked for; picking a fee-charging shape and leaving the amount blank will not save.
Alongside the amounts sit "First year free?" and "Annual Fee Waived On Yearly Spend", which is the
spend inside one membership year that cancels the next annual fee.
"Card Opened On" anchors the MEMBERSHIP YEAR — the twelve months from the card's own anniversary,
which is the window a bank actually measures a fee waiver over. A card's summary screen reports its
waiver progress, spend and rewards over that year and prints its exact dates. Without an opening date
the app falls back to the financial year and says so on screen rather than quoting the wrong window.
A card with no fees recorded is treated as lifetime free.

# Cashback / Rewards
Cards can earn cashback at a default rate or per-mode rates (e.g. UPI, swipe). A rate is applied to
what the CARD WAS CHARGED, not to what the purchase cost: on a ₹187 order part-paid with ₹81 of
wallet money the card was charged ₹106, so a 50% mode expects 53 jewels, not 93. The issuer never
sees the other ₹81 — the same reason it stays off the statement and out of the card's dues. (An
existing entry keeps whatever figure was stored with it; re-picking its Cashback Mode recomputes.)
The app tracks expected vs. realized cashback per card per billing cycle. Cashback can be instant or delayed, credited in the
same cycle or the next, as rupees or as reward points, and deposited into a chosen account. In
Cards → Rewards the user confirms realized cashback, which posts a consolidated "Cashback"
credit into that account. The screen leads with what is still pending, and rupees are kept SEPARATE
from every other reward unit — a card paying in points is listed in its own unit and never converted
into the ₹ figure, because a conversion rate is what a point is worth if you spend it a particular
way, not what you are owed. Before confirming you can tap the pencil to edit a cycle's cashback amount;
you can also undo a confirmed cashback. When a cycle has two or more pending cashbacks, a "Confirm
All" button in that cycle's header confirms them all at once (at their expected amounts).
Confirming already merges a cycle's cashbacks into one credit automatically. A "Merge Credits" button
appears only on a FULLY confirmed cycle whose credited entries aren't covered by a single credit —
that means something went wrong (the confirmed amounts totalled zero, or the data came from an
import), and tapping it repairs them. It is always safe to press; it never shows mid-confirmation.

# Group Splits
Split shared expenses among people. Create an event with a name and people. Each item can be split
equally or unequally, among any subset of people, and tracks who paid and who has settled. Events can
be one-off or recurring (with cycles, a frequency, and a start date). Mark people paid, end a cycle
(carrying unpaid people over), or mark the whole event settled (and re-open it). Starting a new cycle
can carry forward the previous cycle's items; unequal splits have an "Auto-Split Remaining" helper.
The detail screen has a "Settle Up · Who Pays Whom" section that simplifies everyone's balances into
the fewest payments across ALL participants (including friend-to-friend debts, not just yours), plus
a per-person balance list. Share the summary as text or as an image: the image shows settle-up and
the itemized expenses (each expense lists who it was split among); a large split is split into a
Settle-Up image plus paginated Expenses images.

# Lending & Borrowing (Debts)
A per-person ledger of money lent or borrowed, plus repayments. Add a person/debt, log repayments
(received or sent), mark individual entries done, and settle a debt. Each person shows a
net balance: they owe you, or you owe them. This feature supports 2-way sync: logging an entry in the
Debt ledger can automatically create a transaction, and conversely, logging, editing, or deleting a
transaction under the "Lending & Borrowing" category with a description format of "<PersonName> : <Lent/Borrowed/Repayment>"
automatically creates, updates, or deletes the corresponding entry in the Debt ledger in real-time. Ledger
entries can be linked to real transactions; when you delete a linked entry you can choose to delete both
or keep the ledger transaction ("Remove from History Only"). Settling a debt that still has a balance
offers "Settle Now", which adds a closing Final Settlement entry. The tick in the debt's header is
"Mark all as done": it marks every entry done and settles the debt in one tap, and ticking all the
entries yourself settles it too. It only works one way — to re-open a settled debt, un-tick any entry.
A debt whose net balance reaches zero settles on its own, with all its entries marked done. Entries logged to the main ledger use the
"Lending & Borrowing" category, so they never count toward Spends or Income (see Categories & Budgets) —
only the account balance moves.
The add/edit entry form previews the balance AS OF THAT ENTRY'S OWN DATE — the running balance just
before it, then after it — not the debt's final net. So editing the 2nd of 10 entries shows what the
balance was back then, and changing the date re-slots the entry and updates the figures. When that
differs from the final net, the form also shows "Net after all entries".
When editing an entry you can switch its direction (e.g. a repayment received becomes a repayment
sent, or lent becomes borrowed) — both direction options stay available while editing, even if the
debt has no history in that direction. If the entry auto-created a mirror transaction in the main
ledger, retyping flips that transaction between debit and credit to match. A transaction you linked
manually keeps its own debit/credit.

# Bills
Recurring bills — rent, utilities, subscriptions, credit card statements — with an amount, frequency
(daily/weekly/monthly/quarterly/half-yearly/yearly/custom), and a next due date. Each bill offers LOG
(create a new transaction), LINK (attach an existing transaction instead), or PAID (record it
without a transaction). All three do the same thing to the bill: they roll it to its next
occurrence.
A recurring bill has no "paid" or "done" state — it is only ever due again. There is no tick to
clear and no completed list; the countdown IS the status. Pay a 90-day recharge on its due date and
it immediately reads "in 90 days" for the next cycle. A bill that has passed its due date reads as
overdue and stays that way until LOG, LINK or PAID rolls it forward, so an overdue bill means the
payment was never recorded against it — paying in real life is not enough on its own.
The next due date advances from the OLD due date, not from the day it was recorded, so a cycle
stays anchored even when paid early or late. LOG and LINK date the payment from the transaction;
PAID dates it today.
Credit card statement dues appear here automatically from each card's due day. Those DO settle —
a statement genuinely closes — so a card with nothing outstanding shows "No Dues". Only credit
cards ever show that; a manual bill never does.
There is exactly ONE row per credit card, never two. A card is not one row per statement, so an
unpaid statement and a newly generated one do not appear side by side — they are added together on
the card's single row, and the row breaks the total down. A card carrying money from an older
statement shows a red band naming the months it is from ("Jul statement unpaid ₹5,000"), the current
statement and its countdown beneath it ("This statement · In 2 days ₹7,240"), and then the sum as
"To clear ₹12,240" with an OVERDUE badge. The figure LOG prefills is that total, not the current
statement alone. A card whose own statement has simply gone past its date shows the countdown as
"3 days overdue" instead, with no band, because nothing older is owed.
An unpaid statement therefore stays in the card's outstanding balance and in its credit utilisation
after the next statement is cut, instead of dropping out of both. Anything at or under ₹1 is still
counted in that balance but is not called overdue — it is rounding residue, since a statement is
rounded and the payment against it is not.
Any category can be picked for a bill, INCLUDING Mutual Funds — so a fund instalment can still be
tracked here purely as a due-date reminder. What no longer exists is the dedicated SIP wiring: a bill
can NOT be linked to a mutual fund account, and logging it does NOT auto-credit that account. A
Mutual Funds bill behaves like any other bill; its LOG button opens the normal investment form where
the user chooses the funding account and the fund account themselves. Holdings and returns are
tracked in Wealth, not here.
A bill's LOG button opens the SAME form as "Log Transaction" on the Ledger, so everything available
there is available here — tags, instant cashback, Split Payment, investment fields, NCMC travel,
the passive-log toggle. The only differences are deliberate: logging from a bill also advances that
bill's next due date and marks the entry recurring, and SMS auto-fill is a Ledger-only entry point.

# Wealth
The top-level screen showing everything the user owns. It opens on a summary total ("<Name>'s Wealth")
followed by up to three category cards, each with a chevron that opens its own sub-view:

1. **Portfolio** — market investments: Stocks, Mutual Funds, Commodities (gold/silver).
2. **Assets** — liquid money: Bank Accounts, Physical Cash, E-Wallets, plus an "Other" group holding
   Debit Cards, Rewards wallets, Offset Ledgers and any user-created custom account types.
3. **Retirement** — EPF (Employee Provident Fund).

The headline Wealth total = Portfolio current value + Assets liquid balance + Retirement balance. It is
GROSS wealth: credit cards are excluded entirely (they're a liability) and tracked Debts are NOT
subtracted, so this figure is not a net-worth number. A rewards wallet denominated in points/miles
(it has a reward unit) IS counted, at its rupee worth: its ledger is kept in rupees and the unit
figure is that value read at the wallet's rate, so counting it adds no estimate — and the same money
in a rewards wallet that names no unit was always counted, so excluding it made the total disagree
with itself. Its row states both ("500 Chips" with "= ₹50" beneath). An NCMC debit card's
travel-wallet balance IS counted too, on top of its main balance. Only an Offset Ledger is left out.

A category with no accounts is hidden — no card, no sub-view — and a muted hint below the cards names
what's missing and points to the Accounts tab. A user with nothing at all sees a single empty state.

## Portfolio sub-view
Invested vs. current value with gain/loss, today's gain/loss, a "Refresh prices" button and a "Last
refresh at" timestamp. Prices: stocks/funds are fetched online; gold/silver are AI-estimated via the
optional Gemini integration or set manually (₹/gram). Filter pills (All / MF / Stocks / Metals) appear
only for the asset classes the user actually holds, and only when there's more than one. With a single
class selected, a pill on that section's header cycles what every row shows on its right — Current
(Invested), 1D Change, or Returns — tap the label to step forward or the ‹ › chevrons to move either
way. Metals offer only Current (Invested) and Returns, having no dependable previous close; on All the
pill is hidden and rows show Current (Invested). Each class
can be expanded/collapsed, and tapping a holding opens its performance chart, range selector,
allocation and transactions. A stock's ranges are 1D / 5D / 1MO / 3MO / 1Y / 5Y (1D and 5D are
intraday, so the chart's tooltip names a time rather than a date); a fund's are 1M / 6M / 1Y / ALL.
Every chart opens on the leftmost range in its own row and does not remember the last one you picked
— reopening any holding or account starts fresh. An individual holding can also be refreshed from its
account card in the Accounts tab.

### Average buy price
Every market holding shows what it cost per unit: "Avg. Buy Price" (stocks), "Avg. Buy NAV" (funds) or
an average ₹/gram (metals), on the holding's detail sheet directly under its unit count, and as an AVG
line under TOTAL SHARES / TOTAL UNITS / TOTAL GRAMS on that account's card in the Accounts tab. It is
DERIVED — total invested ÷ total units — and never entered by the user, so there is no field for it in
the Add/Edit Account form and it cannot be edited directly; correct it by correcting the invested value
or the unit count. Because it needs no market price, it still reads when a live quote fails to fetch.
The mutual-fund form's optional "Average NAV" is NOT this figure: it is only a fallback used to
estimate invested value when that field is left blank.
Caveat to state if asked how accurate it is: total invested is net cash flow, and a sell subtracts the
full sale proceeds rather than the cost of the units sold — so after a partial sale at a profit the
average sits BELOW the true cost basis. For a holding that has only ever been added to, it is exact.

## Assets sub-view
Total cash and funds available, with filter pills (All / Bank / Cash / Wallets / Other) shown only for
the groups present. Each row shows the account's running balance and its type. Tapping a row opens
that account's detail screen: its balance, what the month did to it, a balance trend (1M / 6M / 1Y /
ALL — 1M is day by day, the longer windows month by month), the month's Income and Spends, and the
five most recent transactions. Income and Spends there follow the same rule as the Transactions
screen's: transfers, card bill payments, investment legs, lending & borrowing, NCMC recharges and
Passive Logs are excluded, so the two figures state money genuinely earned and spent through that
account rather than every rupee that crossed it — which is also why they do NOT add up to the balance
change stated above them (that one counts every movement).
A REWARDS WALLET IS THE EXCEPTION to that rule, and says "Earned" and "Redeemed" rather than Income
and Spends. Those two count EVERY movement of the wallet, exclusions ignored, because they ask a
different question: what came into the wallet and what left it. Redeeming rewards against a card
bill is category "CC Payment", which the rule above excludes — so under it "Redeemed" always read
zero for the commonest redemption there is, while the redemption itself sat in the same screen's
Recent Activity. This applies to every rewards wallet, whether or not it names a unit.
A points wallet additionally reads in its own unit, states its rupee worth beneath the headline
("= ₹50"), and has no 1M window — its trend needs at least two months of history, so a wallet
created this month shows no chart at all. An NCMC card also shows its travel wallet. To see every transaction on an account, or to edit one, use the Transactions
and Accounts tabs.

## Retirement sub-view
Total EPF running balance and interest earned this financial year, plus the monthly credit breakdown
(12% employee + 3.67% employer EPF + 8.33% EPS pension), the 1-year projected balance and projected
annual growth. Interest accrues monthly and is credited March 31st. Tapping an EPF account row opens
Wealth's read-only breakdown of it; to change anything, edit the account on the Accounts tab.

# Commodity (gold / silver) prices
Gold/silver per-gram prices are approximate AI estimates fetched from a vendor (price reference) using
the Gemini key, and may lag the live rate. Supported vendors include MMTC-PAMP, SafeGold, Augmont, and other digital gold/silver vendors. To fix or change them:
- Change the vendor (price source): Settings → Commodity AI → "Vendor (price reference)" dropdown/field →
  select or type the vendor name (MMTC-PAMP, SafeGold, Augmont, etc.) → Save. The next fetch uses that source.
- Set an exact price: open the commodity account's editor and set a manual ₹/gram override, which
  takes precedence over the AI estimate.
- Auto-fetch needs the Gemini key (Settings → AI Features); without it, use the manual ₹/gram.
There's a daily safety cap on AI price/logo lookups, and prices are cached for about an hour.

# Insights
Pick a month to see: total spend and income (vs. the previous month), top category, top account,
biggest transaction, transaction count, spend by category / account / tag, weekend spend, recurring
spend, a daily spend streak, and budget-vs-actual per category. All spend figures exclude the system
categories above and respect exclude-from-stats. The Top Category and Biggest Expense highlights also
exclude the "Rent" category (a predictable recurring bill) so they surface your most notable
unplanned spend — total spend and the category breakdown still include Rent.

Transaction count (and the per-category / per-account / per-tag counts beside each breakdown) counts
only real spending activity: system categories (transfers, CC payments, investments, NCMC travel
recharge), auto-logged cashback, reward-split legs, and fully excluded passive logs are all left out.
A partially excluded transaction still counts as one — only the excluded rupees are dropped, not the
transaction. So the count can be lower than the number of rows you see on the Ledger for that month.

# SMS auto-log (Android only)
On Android the app can read bank SMS on-device and create transactions automatically (opt-in:
autoLogSms). OTPs and personal messages are excluded on-device and never sent anywhere. Paired bank
messages (e.g. a payment and its confirmation) are de-duplicated. An optional AI second filter
(Settings → AI Features → "Smarter SMS Filter"; Gemini, opt-in) drops EMI offers, promos, and
reward-point "credits" before logging; if it errors it
fails open (keeps the SMS). New SMS appear as a preview queue to confirm before adding, and they
arrive whether the app is open or closed — with the app on screen the pending card appears live.
While the AI filter is deciding (a couple of seconds) the Ledger shows one card for the whole batch —
"Checking 4 SMSes" — never one card per message, so a drain of ten notifications cannot push the
transaction list off the screen. When the batch finishes, that card reports the result for a few
seconds before retiring: how many were detected as transactions, and how many were dropped as not
real ones (the dropped count appears nowhere else — a filtered SMS leaves no other trace). If there
are also messages waiting to be confirmed, the pending card and the screening card share a single
row, half the width each, rather than stacking. The merchant
name parsed out of the SMS becomes the transaction's description (kept in the bank's original casing).
That preview queue is saved on-device so it survives closing/restarting the app, but it is device-local
and is deliberately NOT included in a backup/export — confirm or discard pending items before restoring
a backup elsewhere.

# Profile & appearance
- Profile: tap your profile card in Settings → User Details to set your name and a profile photo (with
  a cropper).
- Theme: switch light/dark in Settings → App Theme (Dark Slate / Light Mist).
- App version: Settings → App About shows the app version and build; Settings → Help Center opens an
  email to the developer for support.

# First launch (onboarding)
On first launch you enter your name, then choose "Set up a PIN" or "Use without a lock"; if you set a
PIN you confirm it and are shown a 16-character recovery key to save. Instead of setting up fresh you
can tap "Restore from backup" on the first step to import an existing backup file.

# Security & app lock
- App lock is OPTIONAL. During setup you can choose "Use without a lock" (no PIN), and such users never
  see a lock screen.
- PIN: an optional 4-digit PIN, stored only as a hash. When you set a PIN a 16-character recovery key is
  shown once — save it.
- Setting a PIN later: Settings → User Details → type it under SET PIN and again under CONFIRM PIN.
  Nothing else is asked for when the app has no lock yet — the CURRENT PIN field only appears once one
  exists. "Save Changes" appears as soon as the two match, then a recovery key is generated for you to
  save, and you are taken to the lock screen to unlock with the PIN you just chose.
- Biometrics: can be enabled (Settings → User Details) once a PIN is set — including in the same pass
  as a first PIN, since the toggle comes alive as soon as the two PIN fields match.
- Remove the PIN: Settings → User Details → "Remove PIN (use without a lock)" (authorized by your
  current PIN or biometrics); this clears the PIN, recovery key, and biometrics.
- Forgot PIN: on the lock screen tap "Forgot PIN?" — either enter your recovery key, or
  "Wipe & Reset" to erase everything if the key is lost.
- What the recovery key does: it proves who you are, it does NOT unlock the app on its own. A correct
  key opens a "set a new pin" screen — enter a new 4-digit PIN, confirm it, and you go straight in
  with that PIN in force from then on. Your recovery key stays the same; there is no new one to save.
  The screen has no close button on purpose, because the old PIN is the one you have just told us you
  forgot. The other way off it is "Use without a lock", which removes the PIN, the recovery key and
  biometrics together — the same set Settings' "Remove PIN" clears — and you can set a fresh PIN any
  time from Settings → User Details. Closing the app mid-way changes nothing: the old PIN and the same
  recovery key still work.

# Backup, restore & data
- Export: Settings → Export Data, with two different outcomes:
  - "Save to Documents" writes the backup file into the device's Documents folder — a real file that
    stays there. The screen then confirms "Backup saved!" and offers "Share File".
  - "Share Directly" only hands the file to the OS share sheet. NOTHING is saved to the device:
    whether a copy survives depends on the app picked (Files or a cloud app keeps one, a messaging
    app just sends it). The screen says "Backup shared!" and offers "Save to Device".
  - (Advanced) copy it to the clipboard as a compressed code.
  - If the direct save fails, the app says so and falls back to the share sheet.
  Field names are minified to shrink the file.
- Import: Settings → Import Data — restore from a backup file or by pasting a copied code. Importing
  OVERWRITES current data.
- Demo data can be loaded to explore the app and cleared without touching real data.
- Wipe data: Settings → Wipe Data → "delete forever" button clears all accounts, transactions, and settings after confirmation.

# AI features & integrations
- The optional Gemini API key powers commodity prices, brand logos, the SMS filter, and this assistant.
  It's stored in the device keystore (never bundled); removing it disables all those AI features.
  In Settings → AI Features you can Test a saved key, and a meter shows today's AI-fetch count against
  the daily cap (50).
- Asset Logos: Settings → Asset Logos — optionally add a logo.dev token for sharper brand logos.
  Real brand logos are shown for stocks/funds AND for liquid accounts (banks, e-wallets, debit cards,
  rewards wallets) on Wealth → Assets, resolved from the account's NAME: a built-in registry first, then
  a cached background Gemini lookup for brands the registry misses (cached permanently, so it's a
  one-time lookup per name and counts against the daily AI cap), then a conservative domain guess.
  If no logo resolves it falls back to a Google favicon and finally a 2-letter coloured monogram;
  physical-cash accounts always show a wallet icon. No API keys are required — without them the chain
  still yields favicons or initials, and logos already loaded are cached on-device for offline use.
- Background Guide (Android): Settings → Background Guide gives per-brand battery-optimization steps so
  SMS auto-log keeps working in the background.

# This assistant (Ask Vault)
Mostly read-only: it explains the app and reports on your data, and cannot edit or delete anything.
The one exception is contract-note import: tap the paperclip in the Ask Vault input to attach a broker
contract note (image or PDF, e.g. Groww/Zerodha style). It parses the buy trades and allocates the
pooled charges (brokerage/STT/GST/stamp duty) across them, then lets you review/edit the rows, pick or
create the stock account, and log them as stock buy transactions (sell rows are skipped). This needs
the Gemini key. It's opt-in (Settings → AI Features), and the first time you open it you must tap
"Enable & continue" to consent. It sends a summary of your finances plus your question to Gemini to
answer; card numbers, CVVs and the PIN are never sent.
`.trim();
