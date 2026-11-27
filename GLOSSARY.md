# FSA

A personal money tracker that runs as a home-screen web app and keeps its data on the device. These are the words its code, screens and documents use for money, so every screen means the same thing by them.

## Language

### Accounts and imports

**Account**:
A named place money sits in or is spent from, such as a bank account, a card or a broker account. Rows, balances and transfers follow the account's identity, so renaming it changes no figure.
_Avoid_: wallet, bank (for the account itself)

**Account kind**:
The type of an account: bank, debit card, cash, credit card, broker or trip list. The kind, not the name, decides how the account's rows are counted and which figures they feed.
_Avoid_: account type

**Cash account**:
An account of kind bank, debit card or cash, holding money that really comes in and goes out. Bank and debit card accounts are the current accounts; a credit card is never a cash account.
_Avoid_: liquid account

**Trip list**:
An account kind that holds a ride and delivery platform's trip statement. It gives matching charges from any account a category and contributes no transactions or money of its own.
_Avoid_: trips account, order history

**Source**:
A statement format the app can read, named by a neutral id rather than by whoever issues the statement. Each account says which source reads its files.
_Avoid_: bank, provider

**Batch**:
One imported statement file and everything it brought in. Undoing a batch removes only the rows that no other batch holds.
_Avoid_: upload, import file

**Coverage**:
The dates a batch says its statement covers. A month outside every batch's coverage may be missing rather than empty.
_Avoid_: statement period, date range

### Rows and currencies

**Row**:
One transaction from a statement, in its account's own currency. A row the app can identify with confidence is stored once however often it is imported; an overlap it cannot tell apart is kept and marked as a possible duplicate for the reader.
_Avoid_: line, entry

**Display currency**:
The currency the reader chose to see every figure in. Rows keep their original currency; only what is shown changes.
_Avoid_: base currency, home currency

**Conversion**:
Turning an amount into the display currency at the daily reference rate published on or before the amount's date. With no rate the converted amount is unavailable, never zero.
_Avoid_: exchange

**Partial**:
A figure that is missing at least one input it should include, such as a row without a rate or an asset without a value; it says so and names what is missing. The known part can be zero, and labels such as "at least" or "at most" say which side has missing data rather than promise a bound, because a missing amount can be negative.
_Avoid_: estimate, approximate

### Balances

**Statement balance**:
A dated balance printed on a statement. The newest one per account and currency is the best known balance, even when the months before it were never imported.
_Avoid_: printed balance

**Starting balance**:
A dated balance the reader chooses for an account and currency, typed in or taken from the earliest statement balance. Calculations from it count only the rows after its date; it is used when no statement balance exists, and to check statements.
_Avoid_: opening balance, initial balance

**Balance**:
What an account holds in one currency. The latest balance is the newest statement balance plus the rows after it, and a balance at a past date starts from the nearest statement on or before that date and adds the rows between, or works back from a later statement by subtracting them; with no statement balance, both come from the starting balance plus later rows, and dates before the starting balance are unavailable.
_Avoid_: total (for one account)

**Change**:
An account's Closing minus its Opening over a period. It includes ordinary transfers between the reader's own accounts, so it can differ from cash flow.
_Avoid_: net, left over, balance (for a net change)

### Categories and review

**Category**:
One name from a fixed list (such as Groceries, Eating out, Transport or Fees) that a spending row belongs to. Uncategorised is the absence of a category, not a category.
_Avoid_: tag, label

**Merchant key**:
A row's description reduced to a stable payee key, with processor prefixes, dates and shouting removed. All rows with one key share one merchant rule; approvals are kept per key and currency.
_Avoid_: payee name, merchant name

**Merchant rule**:
The category remembered for a merchant key, set by the reader or by the classifier with the reader's approval.
_Avoid_: auto-category

**Line category**:
A category set on one row, by the reader or from a trip list. It beats the merchant rule for that row only.
_Avoid_: per-charge category, override

**Role**:
The reader's mark on one incoming row: income, not income, or refund. It overrides the automatic income test.
_Avoid_: tag, mark

**Approval**:
The reader's record that a merchant is known and, in one currency, normally charges within a range; one merchant can have an approval per currency. Review uses it to stop calling the merchant new and to flag charges outside the range.
_Avoid_: allow-list, whitelist

### Transfers

**Own transfer**:
The ordinary kind of transfer: money moved between two of the reader's own accounts that is neither a card payment nor a broker transfer. It is not income, not spending and not cash flow.
_Avoid_: internal transfer

**Card payment**:
A bank outflow that pays a credit card. It is cash out for the bank and a payment for the card, and never spending: the purchases it pays are the spending.
_Avoid_: card bill (as spending), repayment

**Broker transfer**:
Money moved between a bank and a broker, as a deposit or a withdrawal. It is not spending or income, but it is cash out or cash in.
_Avoid_: investment

**Transfer state**:
How sure a transfer is: matched (two legs with evidence), suggested (two legs by amount and date only, waiting for the reader) or provisional (one leg only). By default a suggested pair stays out of income and spending and is reported as pending; a leg the reader gives a role leaves the pending count, an incoming leg marked income counts as income, and a rejected pair counts as ordinary rows.
_Avoid_: status

**Saved or invested**:
A payment out of a bank account that the reader marks as money put aside or invested outside the tracked accounts. It stays in cash out and cash flow, but it is not spending, and the savings rate counts it as saved.
_Avoid_: savings transfer

### Figures

**Cash on hand**:
The balance held in bank and debit card accounts at a point in time, as Home and the Accounts view show it: a position, not a movement. Cash-kind accounts count toward cash in and out but not toward cash on hand.
_Avoid_: cash, balance (for the total)

**Cash in**:
Money coming into the cash accounts in a period, ordinary own transfers left out. The Accounts view counts bank and debit card accounts only.
_Avoid_: money in, inflow

**Cash out**:
Money leaving the cash accounts in a period, ordinary own transfers left out; the Accounts view counts bank and debit card accounts only. A card payment, a payment saved or invested and a broker deposit are cash out.
_Avoid_: money out, outflow, spending

**Cash flow**:
Cash in minus cash out over a period. Unlike an account's Change, it leaves out ordinary transfers between the reader's own accounts.
_Avoid_: left over, net, money in and out

**Income**:
An incoming row classed as income: by default a credit on a cash account that is neither a refund nor a transfer leg, so reimbursements and gifts count too. The reader's role overrides this: Not income removes a row from income without changing cash in (roles never affect cash in), and in the Overview, Income can also count a broker credit or an incoming transfer leg, while the Accounts view never counts a transfer leg as income.
_Avoid_: salary, earnings

**Spending**:
Expenses counted when incurred and net of refunds: a card purchase on its purchase date, a bank debit on its date. A card payment and a payment saved or invested are not spending.
_Avoid_: cash out, expenses

**Card debt**:
What the reader owes on a credit card: the latest statement's debt adjusted by every charge, payment and credit after it, shown as Card debt now beside the amount shown on the statement. It is subtracted only in net worth, never from cash on hand.
_Avoid_: liability, owed, card balance

**Net worth**:
Cash on hand, investments and pension and insurance values, less card debt, each part at its newest value. It is labelled "at least" when only an asset is missing, "at most" when only card debt is and "incomplete" when both are (labels, not guaranteed bounds), and is not shown when no asset has a value; loans are not tracked.
_Avoid_: total, wealth

**Savings rate**:
Cash flow plus saved or invested, over cash in, for a month. It is a cash-basis stand-in for the textbook rate of income minus expenses over income.
_Avoid_: savings ratio

**Investment return**:
An approximate money-weighted return per broker statement period: market change over the start value plus half the net deposits (deposits less withdrawals). It is not annualised, not time-weighted, and uses statement values rather than cost.
_Avoid_: performance, yield
