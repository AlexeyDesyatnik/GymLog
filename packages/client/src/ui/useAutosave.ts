import { useCallback, useEffect, useRef } from "react";

const DELAY_MS = 700;

/**
 * Saves what the user types shortly after they stop typing, and at once when the
 * field loses focus or the app leaves the screen (phone locked, app switched), so
 * nothing typed is lost and half-typed values like an emptied weight aren't saved.
 */
export function useAutosave(): {
  schedule: (save: () => Promise<void>) => void;
  flush: () => void;
  /** Drops what is waiting to be saved. */
  cancel: () => void;
} {
  const pending = useRef<(() => Promise<void>) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const save = pending.current;
    pending.current = null;
    if (save) void save();
  }, []);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
  }, []);

  const schedule = useCallback(
    (save: () => Promise<void>) => {
      pending.current = save;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { schedule, flush, cancel };
}
