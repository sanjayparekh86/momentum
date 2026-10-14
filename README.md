# Momentum Screener

## Next.js (live API + dashboard)
    npm install
    cp .env.example .env.local     # optional: add DATABASE_URL to save history
    psql "$DATABASE_URL" -f db/schema.sql
    npm run dev                    # http://localhost:3000

API:
- GET /api/screener?threshold=5&direction=both&save=1   movers with verdicts
- GET /api/screener?threshold=10&range=3mo              movers over a range: 1d (default), 5d, 1mo, 3mo, 1y, all
                                                        (history is only saved for range=1d)
- GET /api/screener?symbols=WELCORP,TCS&threshold=0      analyze specific stocks
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

The page refreshes every 30 seconds while visible. Completed full-market scans
are cached in server memory for 5 minutes, and concurrent full-market requests
share one scan. A fresh scan can take several minutes. Changing the percentage,
direction, or date range reuses the cached daily history. All-time analysis may
take longer on its first request because it also fetches historical starting prices.
The scan timestamp is the completion time, not the provider's quote timestamp.

Set the minimum move to 0% to display all analyzable stocks. Results are paginated
at 100 rows per page. Stocks without sufficient Yahoo history are listed separately
with failure reasons; the API reports `scanned`, `available`, and `unavailable`.
NSE list failures and Yahoo rate limits fail the request explicitly rather than
falling back to a smaller universe. Custom `symbols` requests bypass the full-market
scan cache. History is saved only for Today.

The Streamlit prototype still uses its separate starter list in `python/app.py`.
