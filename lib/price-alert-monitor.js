import { predictionProgress } from "./journal.js";
import { ALERT_LEASE_MS, alertCandidates, claimAlertCheck, targetReached } from "./price-alerts.js";

export async function checkPriceAlerts({ owner, settings, journal, fetchMarket, notify, active, now = Date.now }) {
  let claimed = false;
  try {
    const lease = await settings((value) => claimAlertCheck(value, owner, now()));
    claimed = lease.owner === owner;
    if (!active() || lease.owner !== owner || lease.leaseUntil <= now()) return;
    const saved = await journal();
    const predictions = alertCandidates(saved.predictions, lease.sent, now());
    const failures = [];
    for (const symbol of new Set(predictions.map((p) => p.symbol))) {
      if (!active()) return;
      const renewed = await settings((value) => value.enabled && value.owner === owner
        ? { ...value, leaseUntil: now() + ALERT_LEASE_MS } : value);
      if (!renewed.enabled || renewed.owner !== owner) return;
      const pending = predictions.filter((p) => p.symbol === symbol);
      try {
        const from = Math.min(...pending.map((p) => Date.parse(p.referenceAt)));
        const market = await fetchMarket(symbol, from);
        if (!active()) return;
        if (!market.quote) throw new Error("No timestamped market quote returned.");
        const latest = await journal((value) => ({
          ...value, predictions: value.predictions.map((p) => {
            if (p.symbol !== symbol) return p;
            const progress = predictionProgress(p, market.quote, now());
            return progress ? { ...p, latest: progress.quote } : p;
          }),
        }));
        for (const prediction of latest.predictions.filter((p) => pending.some((candidate) => candidate.id === p.id))) {
          if (!active()) return;
          if (!targetReached(prediction, market, now())) continue;
          let reserved = false;
          await settings((value) => {
            if (!value.enabled || value.owner !== owner || Object.hasOwn(value.sent, prediction.id)) return value;
            reserved = true;
            return { ...value, sent: { ...value.sent, [prediction.id]: now() } };
          });
          if (!reserved) continue;
          try {
            notify(prediction, market.quote);
          } catch (error) {
            await settings((value) => {
              const sent = { ...value.sent };
              delete sent[prediction.id];
              return { ...value, sent };
            });
            throw error;
          }
        }
      } catch (error) {
        if (!active()) return;
        failures.push(`${symbol}: ${error.message}`);
      }
    }
    await settings((value) => value.owner === owner ? {
      ...value, lastChecked: now(), leaseUntil: 0, owner: null, error: failures.join(" | "),
    } : value);
  } finally {
    if (claimed) {
      await settings((value) => value.owner === owner ? { ...value, owner: null, leaseUntil: 0 } : value);
    }
  }
}
