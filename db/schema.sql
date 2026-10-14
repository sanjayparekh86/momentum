CREATE TABLE IF NOT EXISTS signals (
  id          BIGSERIAL PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  trade_date  DATE        NOT NULL,
  price       NUMERIC(12,2) NOT NULL,
  change_pct  NUMERIC(6,2)  NOT NULL,
  rsi         NUMERIC(5,1),
  score       INT         NOT NULL,
  verdict     TEXT        NOT NULL,
  reasons     JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, trade_date)
);
CREATE INDEX IF NOT EXISTS signals_date_idx ON signals (trade_date DESC);
