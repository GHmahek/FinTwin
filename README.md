# FinTwin — Financial Digital Twin Dashboard

A cleaned-data pipeline plus an interactive dashboard built from `budgetwise_finance_dataset.csv`,
covering the FinTwin brief: data cleaning, a Financial Health Score, income/expense forecasting,
anomaly detection and a money advisor chatbot.

## What it does

**Explore the dataset** — the cleaned BudgetWise data, either platform-wide (150 users) or as one
user's "digital twin" (pick a user or press *Random twin*).

**My finances** — track your own money. Add entries one by one, or import bank statements as
**PDFs and CSVs, several files at once** (mix them freely, drag-and-drop or the paperclip in the chat, or paste CSV rows). Each file is read on its own, so one bad file never blocks the rest; password-protected PDFs are asked for one by one (or skipped). All rows land in one review table with a File column, and rows that repeat across overlapping statements are flagged and unticked. Imports always pass through a review table first: you can fix the type
and category, untick wrong rows, and rows that match something you already added are flagged and
unticked. Password-protected PDFs ask for the password. Scanned (image-only) PDFs cannot be read; use
the bank's CSV or a text PDF. Everything is parsed in the browser and saved in `localStorage`; nothing is
uploaded. *Try with example entries* fills in six months of sample data.

**Ask your Twin** — works in two modes.
- *Rules-based* (default, offline): a keyword engine, not a fixed list of questions. It scores your words against
  many topics (tolerating typos and word endings) and can answer two topics in one reply. It covers your own figures
  (spend on any category, totals, savings rate, best/worst month, averages, payment modes, cities, income vs spending,
  score, anomalies, forecast, emergency fund) and general money topics (investing, loans/EMI, insurance, retirement,
  tax saving, credit score, inflation, FD/gold/crypto, budgeting rules). It also does small calculators from plain
  wording: "5000 a month for 10 years", "EMI for 10 lakh loan, 5 years, 9%", "I need 8 lakh in 4 years".
  Unknown questions get a helpful nudge instead of a random reply. The chat also has a paperclip to attach several statements.
- *AI* (optional): open **AI settings** in the chat, paste your own Anthropic API key and pick a Claude
  model. The model gets only an aggregate summary of what is on screen (totals, score, top categories,
  forecast), never individual transactions or notes. The exact text is shown under "What the AI is sent".
  If the call fails, the chat falls back to the rules advisor. A key kept in a browser is readable by anyone
  using that device, so a real deployment should call the API from a server (for example a small Flask
  endpoint) instead. The answers are general education, not personalised investment advice.

**Machine learning (scikit-learn, in `pipeline/analyze.py`)**
- *Isolation Forest* (300 trees, unsupervised) scores every transaction on log-amount, distance from its
  category's norm, sign, type, weekday and month. It agrees with the IQR rules on about 80% of their flags and
  finds extra ones the rules miss (mainly zero-rupee expenses).
- *Forecast backtest*: Ridge regression with month-of-year, a random forest on lagged months and the linear
  trend are compared with two simple baselines, using a rolling one-month-ahead test over the last 12 months.
  On this dataset the 6-month average wins, because the monthly totals are mostly noise; the dashboard keeps
  the linear trend (explainable, runs in the browser). The results appear in the "machine learning" section.
- A note-text category classifier was tried in principle and dropped: in this dataset every note appears
  under every category, so there is nothing to learn.
- Learned models run only in the Python pipeline on the sample data. The browser "My money" mode stays
  rule-based so it works offline.

**Design** — a "financial weather" report: the health score sets the sky (clear skies to stormy) and the
headline reads like a forecast. Light theme only.

**Anomaly graph** — every transaction as a dot over time; flagged ones are coloured and shaped by type
(unusually high for its category, extreme amount, negative amount). Available for the platform, each
user, and your own entries. Extreme and negative amounts are pinned to the top/bottom edge so one huge
typo cannot flatten the chart; hover any dot for its real value. In the platform view the grey dots are a
fixed random sample (1,500 of the normal transactions) because 15,000 dots would be unreadable.

Also: confetti when your score crosses 70, responsive down to phones.

## Project structure

```
fintwin-project/
├── index.html            # open this in a browser
├── assets/
│   ├── style.css         # light "weather" theme: tokens, layout, modal, chat panel
│   ├── script.js         # dashboard controller: modes, charts, add/import review flow
│   ├── statement.js      # PDF/CSV statement parser (pdf.js text -> rows), cross-file duplicate check
│   ├── ai.js             # optional Claude advisor (own API key, summary-only context)
│   ├── ledger.js         # "My finances": localStorage, CSV parsing, cleaning,
│   │                     #   and the same scoring/forecast/anomaly maths as the Python pipeline
│   ├── advisor.js        # keyword-scoring chatbot engine, calculators and UI wiring
│   ├── vendor/           # Chart.js 4.4.4 and pdf.js 3.11, bundled so everything works offline
│   ├── fonts/            # Bricolage Grotesque + Figtree, bundled
│   └── data.js           # pre-computed dataset, loaded as window.FINTWIN_DATA
├── data/
│   └── budgetwise_finance_dataset.csv   # original raw dataset
└── pipeline/
    ├── clean.py          # Step 1: normalise categories, payment modes, cities,
    │                     #   dates (4 formats) and mixed-currency amounts
    └── analyze.py        # Step 2: monthly trends, breakdowns, IQR anomaly detection,
                          #   3-month linear forecast, health score → writes assets/data.js
```

## Running it

**Just view it:** open `index.html` in a browser. No server, no build step, and no internet needed:
Chart.js is bundled in `assets/vendor/`. Keep that folder next to `index.html`, otherwise the charts
cannot draw (the page then shows a message saying so).

**Duplicates:** `clean.py` removes rows identical in every column (900 in the supplied file, leaving 15,000).
Rows that only share a `transaction_id` are kept, because they differ in other fields.

**Regenerate the dataset** (after editing the CSV or cleaning rules):

```bash
cd pipeline
pip install pandas numpy scikit-learn
python clean.py
python analyze.py     # rewrites assets/data.js
```

**In VS Code:** open the folder, install the *Live Server* extension, right-click `index.html` →
*Open with Live Server*.

## Importing your own statement

Choose one or more PDFs/CSVs (or paste rows) in **Add money → Import a statement**, or attach them with the chat's paperclip. With a header row the columns can
be in any order: `date, type (Income/Expense), category, amount, payment_mode, location, notes`.
Without a header, that order is assumed. Dates such as `2026-09-01`, `01-09-2026` and `09/01/2026`
all work; amounts may include `₹`, `Rs.` or `INR`; misspelt categories (`Fod`, `Utilties`) are fixed.
Rows without a date or amount are skipped.

## How the numbers work

- **Financial Health Score (0–100):** `0.40 × savings rate + 0.25 × spending stability +
  0.20 × anomaly-free share + 0.15 × category diversification`
  (`health_score()` in `analyze.py`, mirrored in `ledger.js`).
- **Anomalies:** per-category IQR outlier test on expenses, plus flags for negative amounts and
  extreme values (> ₹2,00,000). Flagged rows are left out of totals, trends and the score, but shown
  in the anomaly feed. With very little data (a category with fewer than four expenses) the browser
  version falls back to "more than 3× that category's average".
- **Forecast:** linear regression on the trailing 12 months, projected 3 months ahead. With fewer than
  three months of data it falls back to the average.
- Investments and savings are counted as expenses, as they are in the source dataset, so a high
  investment rate lowers the savings-rate component of the score.

## Tech

Vanilla HTML/CSS/JS, [Chart.js](https://www.chartjs.org/) 4.4.4 and [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (both bundled). Python (pandas, numpy, scikit-learn) for data prep and ML.
No frameworks, no build step.
