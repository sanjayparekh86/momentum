# Momentum Screener

## Next.js (live API + dashboard)
    npm install
    cp .env.example .env.local     # optional: add DATABASE_URL to save history
    psql "$DATABASE_URL" -f db/schema.sql
    npm run dev                    # http://localhost:3000

API:
- GET /api/screener?threshold=5&direction=both&save=1   movers with public trend signals
- GET /api/screener?threshold=10&range=3mo              movers over a range: 1d (default), 5d, 1mo, 3mo, 1y, all
                                                        (history is only saved for range=1d)
- GET /api/screener?symbols=WELCORP,TCS&threshold=0      analyze specific stocks
- GET /api/screener?threshold=5&range=1d&progress=1     current partial full-market scan (does not start a scan)
- GET /api/stock?symbol=TCS                            on-demand quote, indicators, and company news
- GET /api/history?days=30&symbol=WELCORP                saved signals (needs DB)

## Streamlit prototype
    pip install streamlit yfinance pandas pandas-ta
    streamlit run python/app.py

## Market coverage and refresh

The Next.js dashboard scans every symbol in the official NSE equity list:
https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
The list is refreshed daily and includes the equity series published in that file,
not BSE-only stocks or every NSE instrument. Prices come from Yahoo Finance's
unofficial chart endpoint; real-time availability is not guaranteed.

The page refreshes every 5 minutes while visible. Completed full-market scans
are cached in server memory for 5 minutes, and concurrent full-market requests
share one scan. Downloads run in batches of 4 to reduce peak load. Each stock's
indicators and range changes are computed once, then its daily bars are released;
the cache and progress snapshots retain only compact results, not a year of
daily price objects for every stock. Expired full-market results are released
before starting a replacement scan.
A fresh scan can take several minutes. Changing the percentage,
direction, or date range only edits draft options: click **Rescan** to apply them.
Automatic refresh continues using the last applied options, not unsaved edits.
Rescans reuse cached results without recomputing indicators. All-time analysis may
take longer on its first request because it also fetches historical starting prices.
The scan timestamp is the completion time, not the provider's quote timestamp.
Fresh scans expose batches as they complete; the dashboard checks progress every
5 seconds while waiting. Partial counts are explicitly labeled as incomplete.
Existing completed results remain usable during refreshes. All-time results still
wait for historical enrichment before being shown.

Set the minimum move to 0% with the direction set to "Up and down" to display
every listed stock the screener fetched. Results are paginated at 100 rows per
page. Stocks without enough data for full analysis now stay in the main list with
the public signal `INSUFFICIENT` and an explicit reason. The API reports
`scanned`, `available`, `insufficient`, and `unavailable`. `available` counts
stocks with enough history for the full technical model; `insufficient` counts
stocks shown with limited information. NSE list failures and Yahoo rate limits
fail the request explicitly rather than falling back to a smaller universe.
Custom `symbols` requests bypass the full-market scan cache. History is saved
only for Today.

For lower local overhead, use `npm run build` followed by `npm start` instead
of the development server, which also keeps compilation and hot-reload state.
Run only one server for this project at a time. Building itself uses additional
memory; stop the development server before building.

## Search, sorting, and stock details

Search matches stock symbols in the current screener results (set Move to 0%
with "Up and down" to search every listed stock). Sorting supports absolute
movement, gains, declines, symbol, price, RSI, relative volume, technical score,
today's change, and signal. Public signal labels are `BULLISH`, `NEUTRAL`,
`BEARISH`, and `INSUFFICIENT`; score breaks ties for the first three, and
insufficient-data rows stay last when sorting by movement. Click a table header
to sort it; click the active header again to reverse it (▲ ascending, ▼ descending,
↕ inactive). Both run locally without API requests and reset pagination to page 1.
Missing numeric values remain last regardless of order.

Click a stock symbol to open a keyboard-accessible popup. Existing technical
signals appear immediately; quote details and news load on demand. Details include
open, previous close, day and 52-week high/low, volume, RSI, moving averages, MACD,
score, public signal, and reasons. Single-stock responses are cached for 60 seconds
in server memory, with shared concurrent requests. Quote and retrieval timestamps
are shown separately; prices may be delayed.

News uses Yahoo Finance's public search endpoint with the company name and links
to original publishers. Coverage varies; empty results and news failures are
shown explicitly. Missing fields are labeled unavailable, not estimated.
Public labels are non-advisory trend signals, not trading advice or broker
buy/sell prices. The internal BUY/WATCH/AVOID mapping is retained only for future
special-customer features and is not shown in the public UI or API. This source
does not provide fundamentals, valuations, order-book bid/ask, or analyst
recommendations; the popup links to Yahoo Finance for additional research.

## Local watchlists and prediction journal

Use the screener's top **My watchlist & predictions** button to open `/watchlist`.
That separate page lists buckets, watched stocks, and all predictions in tables
with bucket tabs, a status filter, summary cards and pagination; on small screens
scroll horizontally to view every column. **Add stock** opens a two-part entry
form; use **Watch only** to save without a prediction. In prediction history,
**Details** expands the original reasoning, price evidence, learning notes, and
repeat/cancel actions. CSV backups are under **Import / Export**.
Each prediction shows the latest available market quote and its timestamp,
plus rupee/percentage movement since its reference price. Direction/target
progress is provisional and separate from the locked deadline result.
**Refresh prices** also updates completed/cancelled predictions without changing
their original evaluation. Quotes may be delayed or from the previous session;
missing quotes remain unavailable or show the last saved observation.
The refresh icon beside each prediction's current price checks only that stock,
updating all its predictions across buckets. It shows a loading indicator while
the request runs; failures are displayed without discarding the saved quote.
Screener rows and stock details have **Watch / Predict** entry points that open
a dialog for the selected stock, not an inline screener form. Stocks already
watched in any bucket (or with retained prediction history) show **View your
prediction**, opening that stock's saved history in a dialog. Watch-only stocks
show their bucket membership and an option to record their first prediction.
Saving a prediction also adds the stock to its selected bucket.
Watch a stock without making a prediction, or save an up/down expectation with
an optional percentage target, confidence, future weekday deadline, and reason.
The reference is a freshly fetched, timestamped Yahoo quote; it may be delayed
or from the previous session. Quotes older than seven days cannot start predictions.
Terms are locked after save. Cancelled predictions remain in history; "Make another
prediction" creates a separate record. Learning notes remain editable.

There is **no signup, Supabase, or server-side journal database**. IndexedDB stores
the journal only in this browser profile and origin. Clearing site data, changing
browser/port, private browsing, or losing the device can lose access. Export CSV
regularly. CSV backups open in Excel and include buckets, memberships, original
terms, price evidence, results and notes. Import the original Momentum CSV on the
other device/browser; it merges identical IDs without duplication and rejects
conflicting versions atomically without overwriting existing records. Workbooks
(`.xlsx`) and arbitrary spreadsheets are not accepted. Spreadsheet formula cells
are escaped. Imports are limited to 5 MB and journals to 20,000 records.
Local history is user-editable and unverified, not tamper-proof.

Predictions use the selected date's **15:30 Asia/Kolkata daily close**, evaluated
after **18:00 India time**. A target must be achieved at that close, not touched
earlier. Direction correct / target missed and unchanged are separate outcomes.
Weekends are rejected; exchange holidays or missing historical bars stay awaiting
data without substituting another date. Provider-reported splits since the
reference prevent automatic evaluation because old prices may be adjusted.
Dividends are not included in price movement.

Opening the watchlist page or a stock journal dialog, or clicking
**Refresh journal prices & results**, checks watched
stocks and pending predictions sequentially, one symbol at a time, without a
full-market scan. Stock dialogs check only their selected symbol.
`GET /api/journal-market?symbol=TCS&from=<unix-seconds>` provides
read-only quote/history data; it does not store predictions. Checks only run while
the page is open, not as background scheduled jobs. Completed evidence is retained.
The dashboard separates directional accuracy from target achievement and excludes
pending/cancelled/missing-data records. Watchlists paginate at 100 and prediction
history at 20. Journal errors are shown explicitly, including blocked browser storage.

The Streamlit prototype still uses its separate starter list in `python/app.py`.
