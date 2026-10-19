import { emptyJournal, validateJournal } from "./journal.js";

export const JOURNAL_CHANGED = "momentum-journal-changed";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("IndexedDB is unavailable. Enable browser storage to use the journal.")); return; }
    const request = indexedDB.open("momentum-journal", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("journal");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Journal storage is blocked by another tab. Close other Momentum tabs and retry."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export async function journalTransaction(update) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("journal", update ? "readwrite" : "readonly");
    const store = transaction.objectStore("journal");
    const request = store.get("state");
    let result, failure;
    request.onsuccess = () => {
      try {
        const current = validateJournal(request.result || emptyJournal());
        result = update ? validateJournal(update(current)) : current;
        if (update) store.put(result, "state");
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => {
      db.close();
      if (update) {
        window.dispatchEvent(new Event(JOURNAL_CHANGED));
      }
      resolve(result);
    };
    transaction.onabort = () => { db.close(); reject(failure || transaction.error || new Error("Journal storage transaction failed.")); };
    transaction.onerror = () => { failure ||= transaction.error; };
  });
}
