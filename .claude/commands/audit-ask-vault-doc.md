---
description: Audit the Ask Vault knowledge doc for coverage gaps against the codebase
---

You are auditing whether the in-app "Ask Vault" assistant's knowledge doc fully and accurately
covers SpendVault's functionality. The assistant answers grounded ONLY from this doc, so anything in
the code but not in the doc gets an out-of-scope fallback instead of a real answer — those are gaps.

The doc is the `APP_KNOWLEDGE` string in `src/knowledge/appKnowledge.ts`.

## Task

1. Read `src/knowledge/appKnowledge.ts` in full — this is the CURRENT documented surface.

2. Enumerate the app's ENTIRE user-facing surface FROM THE CODE (use the Explore agent for breadth if
   helpful). Cover, at minimum:
   - Every Settings sub-view, toggle, field, and button in `src/components/Settings.tsx`
     (AI Features, Commodity Prices, Asset Logos, Categories, Account Types, Tags, Security/User
     Details, Export/Import, Theme, Manage Accounts, Background Guide, Help, About, Smart Features, etc.).
   - Every tab/feature and the actions it exposes (taps, swipes, long-press, modals, buttons):
     Dashboard, Accounts, Transactions, Cashback, Splits, Debts, UpcomingBills, Wealth, Insights,
     plus modals (TransactionModal, AccountStatement, ViewCardOverlay, CustomPicker, CustomDatePicker).
   - All account types and all transaction categories with special behaviour, and every auto-generated
     (linked) transaction that any action creates (`src/FinanceContext.tsx`).
   - User/Account/Transaction flags in `src/types.ts` that have visible behaviour.
   - Onboarding (`OnboardingScreen.tsx`), auth/lock + recovery (`AuthScreen.tsx`), feature tours
     (`AppTour.tsx`), theme switching.

3. Classify each item: COVERED / MISSING / WRONG-or-INCOMPLETE.

4. Output a prioritized GAP LIST. For each MISSING or WRONG item give:
   (a) the feature/action, (b) the exact UI path or gesture from the code, (c) `file:line` evidence,
   (d) a one-line doc sentence to add or correct.

Focus on what a user would actually ask "how do I…" about. Skip dev-only/internal code.

## Output

Report the gap list only — do NOT edit files unless the user explicitly asks you to apply the fixes.
If asked to apply, edit only the `APP_KNOWLEDGE` string in `src/knowledge/appKnowledge.ts`, keep
entries concise (one sentence each), then run `tsc -b` to confirm it still compiles.
