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
share one scan. A fresh scan can take several minutes. Changing the percentage,
direction, or date range reuses the cached daily history. All-time analysis may
take longer on its first request because it also fetches historical starting prices.
The scan timestamp is the completion time, not the provider's quote timestamp.
Fresh scans expose batches as they complete; the dashboard checks progress every
2 seconds while waiting. Partial counts are explicitly labeled as incomplete.
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

The Streamlit prototype still uses its separate starter list in `python/app.py`.
