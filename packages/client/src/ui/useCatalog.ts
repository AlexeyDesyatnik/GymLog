import { useCallback, useEffect, useState } from "react";
import type { CatalogExercise, Journal } from "../journal/journal.ts";

/**
 * The Exercise catalog, or the part of it found by the typed text; read again whenever records
 * arrive from the user's other devices, and on reload after a change. Null until it is read.
 */
export function useCatalog(journal: Journal, text = ""): { exercises: CatalogExercise[] | null; reload: () => void } {
  const [exercises, setExercises] = useState<CatalogExercise[] | null>(null);
  /** Bumped to read the catalog again. */
  const [reads, setReads] = useState(0);
  const reload = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    // Only the answer for the latest text is shown, whatever order the answers come in.
    let current = true;
    void journal.listExercises(text).then((found) => {
      if (current) setExercises(found);
    });
    return () => {
      current = false;
    };
  }, [journal, text, reads]);

  useEffect(() => journal.sync.onRecordsArrived(reload), [journal, reload]);

  return { exercises, reload };
}
