# Ledger Garden

Ledger Garden is a local-first expense tracker for importing bank and credit-card statement CSVs.

## What it does

- Imports CSV statement exports from banks or credit cards
- Lets you map whichever columns your institution uses
- Stores transactions in browser local storage
- Shows monthly spending, income, and category summaries
- Lets you manually recategorize transactions after import

## How to use it

1. On macOS, double-click `/Users/ryansun/Documents/Expense Tracker/start.command` for the most reliable launch.
2. Or run `./start.command` in `/Users/ryansun/Documents/Expense Tracker` and open the localhost URL it prints.
3. If you prefer, you can still try opening `/Users/ryansun/Documents/Expense Tracker/index.html` directly in your browser.
4. Import a CSV statement.
5. Map the date, description, and amount columns.
6. Click `Import transactions`.
7. Filter by month, search transactions, and adjust categories as needed.

## Testing

If you have Node.js available, run `node --test tests/ledger-core.test.mjs` from `/Users/ryansun/Documents/Expense Tracker`.
These smoke tests cover CSV parsing, amount normalization, split parsing, and export escaping in the shared ledger core.

## Sample data

There is a sample statement at `/Users/ryansun/Documents/Expense Tracker/sample-data/sample_statement.csv`.

## Notes

- This version is optimized for CSV exports rather than PDF statements.
- Launching through a tiny local web server is more reliable than opening the file directly in some browsers.
- If a bank exports separate debit and credit columns, leave `Amount` unused and map those two fields instead.
- Duplicate imports are skipped using a combination of date, description, amount, and institution.
