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
- Top bar: "Ask Vault" (this assistant) and the Hub (grid) button.
- The Hub opens: Group Splits, Lending & Borrowing, Bills, Rewards & Offers (cashback),
  Wealth (investments & EPF), and Smart Insights.
- Feature tours: the first time you open each Hub feature (and at first launch) a one-time guided tour
  runs using temporary sample data, which is then cleared. Tours can't currently be replayed.

# Accounts
An account is any place money sits or is owed. Built-in types:
- bank_account, cash, debit_card, e_wallet — normal balances (a credit adds, a debit subtracts).
- credit_card — a debit (spend) INCREASES the outstanding balance; a credit (payment) reduces it.
- stocks / mutual_funds — investments; track invested value and units/shares and current value.
  These are the internal keys; in the Account Type picker the user SEES "Stocks" and "Mutual Funds",
  and the Accounts tab groups them under "Stocks & Investments" and "Mutual Funds". Always answer
  using those visible labels, not the internal keys. The mutual_funds type was previously labelled
  "SIPs" — it covers any mutual-fund holding, bought via SIP or lumpsum. If a user still calls it a
  "SIP account", they mean a Mutual Funds account.
- commodity — gold or silver, valued at a ₹/gram price (AI-estimated or a manual override).
- epf — Employee Provident Fund; tracks running EPF balance, monthly employer/employee credit breakdown, monthly accrued interest for current FY (credited on March 31st), and 1-year projections. Options include Statutory Wage Ceiling (₹15,000 cap) vs Actual Basic + DA.
- rewards — a reward-points wallet (points, not rupees), with a reward unit and conversion rate.
Add or remove custom account types in Settings → Account Types (a type that's in use can't be deleted).
Actions (each account is a card on the Accounts tab):
- Add: Accounts tab → "+" → fill the form → save. For a stock/fund you can search its symbol while adding.
- Edit or archive: use the pencil (edit) and trash (archive) icon buttons on the account's card — there
  is no swipe gesture for accounts.
- Archiving is a soft-delete: the account is hidden from lists, pickers and balance/portfolio totals,
  but KEPT so old transactions still show its name (with a "deleted" badge) instead of "Unknown".
- Restore an archived account: Accounts tab → the "Archived" section at the bottom of the list → Restore.
- View statement (credit cards): the "Statement" button on the card, or tap the card's row in the
  Dashboard's Outstanding Dues list. In the statement, a cycle picker switches between past and current
  billing cycles.
- View saved card details: the "Card" button flips the card to reveal number/expiry/CVV; tap a field to
  copy it.
- Send to Bank: rewards and e-wallet accounts have a "Send to Bank" button that transfers their full
  balance to a bank account.
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
  linked transaction together with its counterpart legs as a block.
- Filter/search: use the Filters panel in the Transactions tab to search and filter by type, account,
  category, tag, or month (with removable filter chips and income/spend summaries).
- Exclude from stats: this control appears in the editor only after you enable Settings → Smart
  Features → Passive Logs. You can exclude a transaction fully, or a partial amount; Dashboard and
  Insights then skip that amount.
- Tag: in the editor, type a #tag. Manage tags (rename/delete, with usage counts) in Settings → Tags;
  deleting a tag removes it from its transactions.

# Auto-generated (linked) transactions — what creates a child log
Several actions create paired/child transactions, linked together (linkedTransactionIds). Editing or
deleting one keeps the legs in sync / removes them together. By category:
- Transfer: moving money between two accounts. Creates a debit on the source and a matching credit on
  the destination (descriptions "Transfer to/from <account>").
- CC Payment: paying a credit card from a bank/payment account. Creates a debit on the paying account
  and a credit on the card (reducing its outstanding). The card credit is applied to the chosen
  billing cycle (current or previous statement).
  - With a reward split: if reward points are used toward the payment, a THIRD leg debits the rewards
    account for the points used; the bank leg covers the rest.
- Mutual Funds: logging a mutual-fund investment (a SIP instalment or a lumpsum purchase). Credits
  the mutual fund account with the allotted amount and debits the paying bank account for (allotted
  amount + any charges). This category was previously named "SIP"; existing transactions are migrated
  automatically.
- Stocks: credits the stock account with the shares and debits the paying account for the cost
  (+ charges).
- Commodity: credits the commodity account with the grams and debits the paying account for the
  rupee amount.
- Cashback (instant): on a debit with instant cashback, an extra credit posts to the chosen rewards
  account (category "Cashback").
- Cashback (delayed): see Rewards & Offers — confirming realized cashback posts a "Cashback" credit
  into the chosen account.
- NCMC Travel Recharge: on an NCMC-enabled debit card, moves money from the card's payments balance
  into its separate travel balance (and travel purchases draw it back down).

# Categories & Budgets
Spending is grouped by category. Add, delete and reorder categories in Settings → Categories (drag a
row by its handle to reorder; "Other/Misc" always stays last). Set or change a monthly ₹ budget per
category in the Insights screen (not Settings), which shows actual-vs-budget progress. Deleting a
category leaves existing transactions with their old category text.
System categories (internal bookkeeping, EXCLUDED from spend totals so transfers/payments/investments
don't look like spending): Transfer, CC Payment, NCMC Travel Recharge, Mutual Funds, Stocks, Commodity, and
Lending & Borrowing. Lending & Borrowing is auto-excluded from both Spends and Income everywhere
(Dashboard, Insights, Ask Vault) because money lent out or borrowed is expected to be returned — it's
not a real spend or income. The "Cashback" category is a credit (income into a rewards/account), not spend.

# Credit cards & billing cycles
A card has a statement day and a due day.
- Statement day: the day the cycle closes. A transaction dated ON or AFTER the statement day rolls
  into NEXT month's statement; before it, it stays in the CURRENT one.
- Billed = the most recently generated statement (what's due). Unbilled = the cycle in progress.
- Due day: shown for reference (when payment is due); it does not lock anything.
- Rounding rule (round/floor/ceil/none) can be applied to the billed amount.
The Dashboard shows billed, unbilled, and total dues per card.

# Cashback / Rewards & Offers
Cards can earn cashback at a default rate or per-mode rates (e.g. UPI, swipe). The app tracks expected
vs. realized cashback per card per billing cycle. Cashback can be instant or delayed, credited in the
same cycle or the next, as rupees or as reward points, and deposited into a chosen account. In the
Rewards & Offers screen the user confirms realized cashback, which posts a consolidated "Cashback"
credit into that account. Before confirming you can tap the pencil to edit a cycle's cashback amount;
you can also undo a confirmed cashback, or consolidate several confirmed entries into one credit. When
a cycle has two or more pending cashbacks, a "Confirm All" button in that cycle's header confirms them
all at once (at their expected amounts).

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
(received or sent), mark individual entries done, and settle (or re-open) a debt. Each person shows a
net balance: they owe you, or you owe them. This feature supports 2-way sync: logging an entry in the
Debt ledger can automatically create a transaction, and conversely, logging, editing, or deleting a
transaction under the "Lending & Borrowing" category with a description format of "<PersonName> : <Lent/Borrowed/Repayment>"
automatically creates, updates, or deletes the corresponding entry in the Debt ledger in real-time. Ledger
entries can be linked to real transactions; when you delete a linked entry you can choose to delete both
or keep the ledger transaction ("Remove from History Only"). Settling a debt that still has a balance
offers "Settle Now", which adds a closing Final Settlement entry. Entries logged to the main ledger use the
"Lending & Borrowing" category, so they never count toward Spends or Income (see Categories & Budgets) —
only the account balance moves.

# Bills
Recurring bills — rent, utilities, subscriptions, credit card statements — with an amount, frequency
(daily/weekly/monthly/quarterly/yearly/custom), and a next due date. Each bill offers LOG (create a
new transaction and advance the due date), LINK (attach an existing transaction instead), or PAID
(mark paid). Credit card statement dues appear here automatically from each card's due day.
Any category can be picked for a bill, INCLUDING Mutual Funds — so a fund instalment can still be
tracked here purely as a due-date reminder. What no longer exists is the dedicated SIP wiring: a bill
can NOT be linked to a mutual fund account, and logging it does NOT auto-credit that account. A
Mutual Funds bill behaves like any other bill; its LOG button opens the normal investment form where
the user chooses the funding account and the fund account themselves. Holdings and returns are
tracked in Wealth, not here.

# Wealth (formerly Portfolio)
Aggregates stocks, mutual fund accounts, commodity holdings, and EPF (Employee Provident Fund): invested value vs. current
value, with gain/loss. Prices: stocks/funds are fetched online; gold/silver are AI-estimated via the
optional Gemini integration or set manually (₹/gram). EPF accounts project running balance, monthly credit breakdown (12% employee + 3.67% employer EPF + 8.33% EPS pension), monthly accrued interest (credited March 31st), and 1-year projected balance. Refresh all prices from the Wealth screen, or
an individual holding from its account card. You can switch view modes, expand/collapse each asset
class (Mutual Funds / Stocks / Commodities / EPF), and tap any holding to see its performance, allocation, subscreen details and transactions.

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

# SMS auto-log (Android only)
On Android the app can read bank SMS on-device and create transactions automatically (opt-in:
autoLogSms). OTPs and personal messages are excluded on-device and never sent anywhere. Paired bank
messages (e.g. a payment and its confirmation) are de-duplicated. An optional AI second filter
(Gemini, opt-in) drops EMI offers, promos, and reward-point "credits" before logging; if it errors it
fails open (keeps the SMS). New SMS appear as a preview queue to confirm before adding.

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
- Biometrics: can be enabled (Settings → User Details) once a PIN is set.
- Remove the PIN: Settings → User Details → "Remove PIN (use without a lock)" (authorized by your
  current PIN or biometrics); this clears the PIN, recovery key, and biometrics.
- Forgot PIN: on the lock screen tap "Forgot PIN?" and enter your recovery key to get in, or
  "Wipe & Reset" to erase everything if the key is lost.

# Backup, restore & data
- Export: Settings → Export Data. "Save to Downloads" writes the backup file, "Share Directly" sends
  it via the OS share sheet, or (Advanced) copy it to the clipboard as a compressed code. Field names
  are minified to shrink the file.
- Import: Settings → Import Data — restore from a backup file or by pasting a copied code. Importing
  OVERWRITES current data.
- Demo data can be loaded to explore the app and cleared without touching real data.
- Wipe data: Settings → Wipe Data → "delete forever" button clears all accounts, transactions, and settings after confirmation.

# AI features & integrations
- The optional Gemini API key powers commodity prices, brand logos, the SMS filter, and this assistant.
  It's stored in the device keystore (never bundled); removing it disables all those AI features.
  In Settings → AI Features you can Test a saved key, and a meter shows today's AI-fetch count against
  the daily cap (50).
- Asset Logos: Settings → Asset Logos — optionally add a logo.dev token for sharper stock/fund logos.
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
