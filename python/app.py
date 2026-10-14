"""Streamlit prototype. Run: pip install streamlit yfinance pandas pandas-ta && streamlit run python/app.py"""
import streamlit as st, yfinance as yf, pandas as pd, pandas_ta as ta

UNIVERSE = ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","SBIN","ITC","LT","TATAMOTORS","TATASTEEL",
            "TATAPOWER","ADANIPOWER","ZOMATO","YESBANK","IRFC","IREDA","NHPC","VEDL","SUZLON","CDSL",
            "NBCC","WELCORP","HAL","BEL","DLF","PNB","RVNL","IRCON","BHEL","SAIL"]

@st.cache_data(ttl=300)
def analyze(sym):
    df = yf.download(f"{sym}.NS", period="1y", progress=False, auto_adjust=True)
    if df is None or len(df) < 60: return None
    df.columns = df.columns.get_level_values(0)
    df.ta.rsi(append=True); df.ta.macd(append=True)
    df.ta.sma(length=50, append=True); df.ta.sma(length=200, append=True)
    l, p = df.iloc[-1], df.iloc[-2]
    chg = (l.Close / p.Close - 1) * 100
    vol = l.Volume / df.Volume.iloc[-21:-1].mean()
    score, why = 0, []
    def add(pts, t):
        nonlocal score
        score += pts; why.append(f"{pts:+d} {t}")
    if l.Close > l["SMA_50"]: add(1, "Above 50D SMA")
    if l.Close > l["SMA_200"]: add(1, "Above 200D SMA")
    if l["MACD_12_26_9"] > l["MACDs_12_26_9"]: add(1, "MACD above signal")
    else: add(-1, "MACD below signal")
    if 50 <= l["RSI_14"] <= 65: add(1, "RSI healthy")
    if l["RSI_14"] > 75: add(-2, "RSI overbought")
    if vol >= 2: add(1, f"Volume {vol:.1f}x")
    if l.Close / l["SMA_50"] > 1.3: add(-2, "Extended >30% over 50D")
    signal = "Bullish" if score >= 4 else "Neutral" if score >= 2 else "Bearish"
    return dict(Stock=sym, Price=round(l.Close, 2), Change=round(chg, 2), RSI=round(l["RSI_14"], 1),
                Volume=round(vol, 2), Score=score, Signal=signal, Why=" | ".join(why))

st.title("Momentum screener")
thr = st.slider("Minimum daily move (%)", 1.0, 10.0, 5.0, 0.5)
side = st.radio("Direction", ["Both", "Up", "Down"], horizontal=True)
rows = [r for s in UNIVERSE if (r := analyze(s))]
df = pd.DataFrame(rows)
if not df.empty:
    m = df.Change.abs() >= thr if side == "Both" else df.Change >= thr if side == "Up" else df.Change <= -thr
    st.dataframe(df[m].sort_values("Change", key=abs, ascending=False), use_container_width=True, hide_index=True)
st.caption("Technical signals only, not investment advice.")
