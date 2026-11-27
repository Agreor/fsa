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
An account kind that holds a ride and delivery platform's trip statement, used only to give matching card charges a category. It holds no money and feeds no total.
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
One transaction from a statement, in its account's own currency. Each row has one identity, so importing the same row twice stores it once.
_Avoid_: line, entry

**Display currency**:
The currency the reader chose to see every figure in. Rows keep their original currency; only what is shown changes.
_Avoid_: base currency, home currency

**Conversion**:
Turning an amount into the display currency at the daily reference rate published on or before the amount's date. With no rate the converted amount is unavailable, never zero.
_Avoid_: exchange

**Partial**:
A figure that lacks at least one row, balance or value it should include, so it is a bound and not the whole. A partial figure says so and names what is missing; it is never silent and never zero.
_Avoid_: estimate, approximate

### Balances

**Statement balance**:
A dated balance printed on a statement. The newest one per account and currency is the best known balance, even when the months before it were never imported.
_Avoid_: printed balance

**Starting balance**:
A balance the reader sets by hand for an account and currency, dated before its first row. It is used only when no statement balance exists, and to check statements.
_Avoid_: opening balance, initial balance

**Balance**:
What an account holds at a date in one currency: its newest statement balance, or its starting balance, plus the rows after it.
_Avoid_: total (for one account)

**Change**:
An account's balance at the end of a period minus its balance at the start, shown beside Opening and Closing.
_Avoid_: net, left over, balance (for a net change)

### Categories and review

**Category**:
One name from a fixed list (such as Groceries, Eating out, Transport or Fees) that a spending row belongs to. Uncategorised is the absence of a category, not a category.
_Avoid_: tag, label

**Merchant key**:
A row's description reduced to a stable payee key, with processor prefixes, dates and shouting removed. All rows with one key share one merchant rule and one approval.
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
The reader's record that a merchant, in one currency, normally charges within a known range. It is used only to flag charges outside that range.
_Avoid_: allow-list, whitelist

### Transfers

**Own transfer**:
Money moved between two of the reader's own accounts. It is not income, not spending and not cash flow.
_Avoid_: internal transfer

**Card payment**:
A bank outflow that pays a credit card. It is cash out for the bank and a payment for the card, and never spending: the purchases it pays are the spending.
_Avoid_: card bill (as spending), repayment

**Broker transfer**:
Money moved between a bank and a broker, as a deposit or a withdrawal. It is not spending or income, but it is cash out or cash in.
_Avoid_: investment

**Transfer state**:
How sure a transfer is: matched (two legs with evidence), suggested (two legs by amount and date only, waiting for the reader) or provisional (one leg only). A suggested pair stays out of income and spending and is reported as pending; a rejected one counts as ordinary rows.
_Avoid_: status

**Saved or invested**:
A payment out of a bank account that the reader marks as money put aside or invested outside the tracked accounts. It stays in cash out and cash flow, but it is not spending, and the savings rate counts it as saved.
_Avoid_: savings transfer

### Figures

**Cash on hand**:
The balance held in cash accounts at a point in time: a position, not a movement.
_Avoid_: cash, balance (for the total)

**Cash in**:
Money coming into the cash accounts in a period, own transfers left out.
_Avoid_: money in, inflow

**Cash out**:
Money leaving the cash accounts in a period, own transfers left out. A card payment, a payment saved or invested and a broker deposit are cash out.
_Avoid_: money out, outflow, spending

**Cash flow**:
The net change in cash over a period: cash in minus cash out. It is not a headline; it shows as Change per account and inside the savings rate.
_Avoid_: left over, net, money in and out

**Income**:
Cash in that is neither a refund nor an own transfer, counted per bank account. It is broader than earned income: reimbursements and gifts received are income too.
_Avoid_: salary, earnings

**Spending**:
Expenses counted when incurred and net of refunds: a card purchase on its purchase date, a bank debit on its date. A card payment and a payment saved or invested are not spending.
_Avoid_: cash out, expenses

**Card debt**:
What the reader owes on the credit cards: the latest statement's debt plus the charges since, shown as Card debt now; the statement's own figure is Debt at statement. It is subtracted only in net worth, never from cash on hand.
_Avoid_: liability, owed, card balance

**Net worth**:
Cash on hand, investments and pension and insurance values, less card debt, each part at its newest value. It shows "at least", "at most" or "incomplete" when a part is missing, and loans are not tracked.
_Avoid_: total, wealth

**Savings rate**:
Cash flow plus saved or invested, over cash in, for a month. It is a cash-basis stand-in for the textbook rate of income minus expenses over income.
_Avoid_: savings ratio

**Investment return**:
An approximate money-weighted return per broker statement period: market change over the start value plus half the deposits. It is not annualised, not time-weighted, and uses statement values rather than cost.
_Avoid_: performance, yield
