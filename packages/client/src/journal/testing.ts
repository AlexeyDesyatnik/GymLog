import { openJournal, type Journal } from "./journal.ts";

let journalCount = 0;

/** A unique IndexedDB name, so tests never share a database. */
export function uniqueJournalName(): string {
  return `journal-test-${++journalCount}`;
}

/** A Journal on its own empty database, with a clock that ticks by 1 ms per reading. */
export function freshJournal(): Journal {
  let clock = 1_000;
  return openJournal({ name: uniqueJournalName(), now: () => clock++ });
}
