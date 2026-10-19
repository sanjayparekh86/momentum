import { deadlineClose, outcome } from "./journal.js";

export const ALERT_INTERVAL_MS = 30 * 60 * 1000;
export const ALERT_LEASE_MS = 10 * 60 * 1000;
export const ALERT_CHANGED = "momentum-alerts-changed";

export function emptyAlerts() {
  return { enabled: false, lastChecked: 0, leaseUntil: 0, owner: null, sent: {}, error: "" };
}

export function validateAlerts(state) {
  if (typeof state?.enabled !== "boolean" || !Number.isFinite(state.lastChecked)
    || !Number.isFinite(state.leaseUntil) || !(state.owner === null || typeof state.owner === "string")
    || !state.sent || typeof state.sent !== "object" || Array.isArray(state.sent)
    || Object.values(state.sent).some((at) => !Number.isFinite(at)) || typeof state.error !== "string") {
    throw new Error("Invalid local price-alert settings.");
  }
  return state;
}

export function alertCandidates(predictions, sent, now = Date.now()) {
  return predictions.filter((p) => p.status === "pending" && p.targetPercent !== null
    && !Object.hasOwn(sent, p.id) && now <= deadlineClose(p.deadline));
}

export function targetReached(prediction, market, now = Date.now()) {
  const quote = market.quote;
  const at = Date.parse(quote?.at);
  if (!alertCandidates([prediction], {}, now).length || !Number.isFinite(quote?.price) || quote.price <= 0
    || !Number.isFinite(at) || at <= Date.parse(prediction.createdAt) || at > now
    || now - at > ALERT_INTERVAL_MS || at > deadlineClose(prediction.deadline)
    || market.splits?.some((split) => split.t * 1000 > Date.parse(prediction.referenceAt))) return false;
  return outcome(prediction, quote.price).result === "target achieved";
}

export function claimAlertCheck(state, owner, now = Date.now()) {
  if (!state.enabled || state.leaseUntil > now || (state.lastChecked && now - state.lastChecked < ALERT_INTERVAL_MS)) return state;
  return { ...state, owner, leaseUntil: now + ALERT_LEASE_MS };
}
