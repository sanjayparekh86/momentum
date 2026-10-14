import { SIGNALS } from "@/lib/table";

export default function SignalBadge({ signal }) {
  const info = SIGNALS[signal] || SIGNALS.INSUFFICIENT;
  return <span className={`v ${signal || "INSUFFICIENT"}`}><span aria-hidden="true">{info.icon}</span> {info.label}</span>;
}
