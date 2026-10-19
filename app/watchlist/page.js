"use client";
import Link from "next/link";
import { useState } from "react";
import PredictionJournal from "../PredictionJournal";
import StockDialog from "../StockDialog";
import useJournal from "../useJournal";
import { hasJournalStock } from "@/lib/journal";

export default function WatchlistPage() {
  const [selected, setSelected] = useState(null);
  const [journalSelection, setJournalSelection] = useState(null);
  const { data } = useJournal();
  const openJournal = (stock) => {
    setSelected(null);
    setJournalSelection({ symbol: stock.symbol, view: hasJournalStock(data, stock.symbol) ? "history" : "create" });
  };
  return (
    <main className="watchlist-page">
      <header className="workspace-header"><div><span className="eyebrow">MOMENTUM / PERSONAL JOURNAL</span><h1>My watchlist</h1><p className="meta">Build your ideas. Track your thinking.</p></div><Link className="btn btn-secondary" href="/">Back to screener</Link></header>
      <PredictionJournal onStock={setSelected} />
      {selected && <StockDialog stock={selected} onClose={() => setSelected(null)}
        onJournal={openJournal} hasPrediction={hasJournalStock(data, selected.symbol)} />}
      {journalSelection && <PredictionJournal key={journalSelection.symbol} symbol={journalSelection.symbol}
        initialView={journalSelection.view} onClose={() => setJournalSelection(null)} onStock={setSelected} />}
    </main>
  );
}
