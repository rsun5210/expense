# Pocket Ledger

Pocket Ledger is a local-first expense tracker for importing bank and credit-card statement CSVs.

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

If you have Node.js available, run `node --test tests/*.test.mjs` from `/Users/ryansun/Documents/Expense Tracker`.
These smoke tests cover the shared ledger core plus categorization, deduping, transfer matching, and monthly summaries in the extracted domain module.

For this workspace, a local Node binary can also be unpacked into `.tools/` and run with `./.tools/node-v22.14.0-darwin-arm64/bin/node --test tests/*.test.mjs`.

## Deploying To Vercel

This app can be hosted as a static site on Vercel with no build step.

1. In Vercel, create a new project from this folder or repo.
2. Leave the framework preset as `Other`.
3. Leave the build command empty.
4. Leave the output directory empty so Vercel serves the project root.
5. Deploy.

If you use the CLI, run `vercel` for a preview deployment or `vercel --prod` for production from `/Users/ryansun/Documents/Expense Tracker`.

## Sample data

There is a sample statement at `/Users/ryansun/Documents/Expense Tracker/sample-data/sample_statement.csv`.

## Notes

- This version is optimized for CSV exports rather than PDF statements.
- Launching through a tiny local web server is more reliable than opening the file directly in some browsers.
- If a bank exports separate debit and credit columns, leave `Amount` unused and map those two fields instead.
- Duplicate imports are skipped using a combination of date, description, amount, and institution.
