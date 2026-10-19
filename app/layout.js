import "./globals.css";
import PriceAlerts from "./PriceAlerts";
export const metadata = { title: "Momentum Screener" };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }) {
  return (<html lang="en"><body><PriceAlerts>{children}</PriceAlerts></body></html>);
}
