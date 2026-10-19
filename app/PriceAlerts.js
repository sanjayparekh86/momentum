"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { journalTransaction, storageTransaction } from "@/lib/journal-storage";
import { marketData } from "@/lib/journal-market-client";
import { checkPriceAlerts } from "@/lib/price-alert-monitor";
import { ALERT_CHANGED, ALERT_INTERVAL_MS, emptyAlerts, validateAlerts } from "@/lib/price-alerts";

const AlertContext = createContext(null);
const settings = (update) => storageTransaction("price-alerts", emptyAlerts, validateAlerts, update, update ? ALERT_CHANGED : null);

export default function PriceAlerts({ children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState("default");
  const [busy, setBusy] = useState(false);
  const check = useRef(null);
  const router = useRouter();

  useEffect(() => {
    let active = true, running = false;
    const controller = new AbortController();
    const owner = crypto.getRandomValues(new Uint32Array(4)).join("-");
    const supported = window.isSecureContext && "Notification" in window;
    setSupported(supported);
    if (supported) setPermission(Notification.permission);
    const sync = () => settings().then((value) => { if (active) setState(value); })
      .catch((e) => { if (active) setError(e.message); });
    const tick = async () => {
      if (running || !active) return;
      running = true;
      try {
        const current = await settings();
        if (active) setState(current);
        if (!current.enabled || !supported) return;
        if (active) setPermission(Notification.permission);
        if (Notification.permission !== "granted") throw new Error("Browser notification permission is not granted. Enable it in site settings or turn alerts off.");
        await checkPriceAlerts({
          owner, settings, journal: journalTransaction, active: () => active,
          fetchMarket: (symbol, from) => marketData(symbol, from, controller.signal),
          notify: (prediction, quote) => {
            try {
              const target = prediction.referencePrice * (1 + (prediction.direction === "up" ? 1 : -1) * prediction.targetPercent / 100);
              const notification = new Notification(`${prediction.symbol}: price target reached`, {
                body: `Latest quote INR ${quote.price.toFixed(2)} meets your ${prediction.direction} target of INR ${target.toFixed(2)}. Quote: ${new Date(quote.at).toLocaleString()}. This is not the final deadline result.`,
                tag: `momentum-target-${prediction.id}`,
              });
              notification.onclick = () => { window.focus(); router.push("/watchlist"); notification.close(); };
            } catch (e) {
              throw new Error(`Browser could not display the notification: ${e.message}. This browser may not support page notifications.`);
            }
          },
        });
        if (active) { setError(""); await sync(); }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        running = false;
      }
    };
    check.current = tick;
    sync(); tick();
    const timer = setInterval(tick, 60000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    window.addEventListener(ALERT_CHANGED, sync);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false; controller.abort(); check.current = null; clearInterval(timer);
      window.removeEventListener(ALERT_CHANGED, sync);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const toggle = async () => {
    if (busy || !state) return;
    setBusy(true); setError("");
    try {
      if (state.enabled) {
        setState(await settings((value) => ({ ...value, enabled: false, owner: null, leaseUntil: 0, error: "" })));
      } else {
        if (!supported) throw new Error("Notifications require a supported browser on HTTPS or localhost.");
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== "granted") throw new Error("Notifications were not enabled. Allow notifications in browser site settings to try again.");
        setState(await settings((value) => ({ ...value, enabled: true, lastChecked: 0, error: "" })));
        await check.current?.();
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <AlertContext.Provider value={{ state, error, supported, permission, busy, toggle }}>{children}</AlertContext.Provider>;
}

export function PriceAlertControls() {
  const context = useContext(AlertContext);
  if (!context) return null;
  const { state, error, supported, permission, busy, toggle } = context;
  return <section className="price-alert-controls" aria-label="Target price notifications">
    <div><strong>Target price alerts <span className={`result-pill ${state?.enabled && supported && permission === "granted" ? "positive" : "muted"}`}>{state?.enabled ? supported && permission === "granted" ? "On" : "Paused" : "Off"}</span></strong>
      <p>Check every {ALERT_INTERVAL_MS / 60000} minutes while Momentum is open. One notification per pending percentage target, before its deadline.</p>
      <small>Keep any Momentum tab open. Background tabs may be delayed; closed pages cannot check. Quotes may be delayed and brief target touches can be missed. Alerts do not finalize predictions.</small>
      {state?.lastChecked > 0 && <small className="cell-subtext">Last check: {new Date(state.lastChecked).toLocaleString()}</small>}
      {!supported && <p className="meta">This browser does not expose page notifications here. Use a supported desktop browser on HTTPS or localhost.</p>}
      {(error || state?.error) && <p role="alert" className="err">{error || state.error}</p>}
    </div>
    <button className={`btn ${state?.enabled ? "btn-secondary" : "btn-primary"}`} disabled={busy || !state || (!supported && !state.enabled)} onClick={toggle}>
      {busy ? "Updating..." : state?.enabled ? "Turn alerts off" : "Enable browser alerts"}
    </button>
  </section>;
}
