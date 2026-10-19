"use client";
import { useCallback, useEffect, useState } from "react";
import { journalTransaction, JOURNAL_CHANGED } from "@/lib/journal-storage";

export default function useJournal() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const state = await journalTransaction();
    setData(state); setError("");
    return state;
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => journalTransaction().then((state) => {
      if (active) { setData(state); setError(""); }
    }).catch((e) => { if (active) setError(`Local storage: ${e.message}`); });
    read();
    window.addEventListener("focus", read);
    window.addEventListener(JOURNAL_CHANGED, read);
    return () => {
      active = false;
      window.removeEventListener("focus", read);
      window.removeEventListener(JOURNAL_CHANGED, read);
    };
  }, []);
  return { data, setData, error, reload };
}
