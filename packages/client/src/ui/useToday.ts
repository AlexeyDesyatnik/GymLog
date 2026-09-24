import { useEffect, useState } from "react";
import { localDateOf, type LocalDate } from "@gymlog/shared";

/**
 * Today's date, refreshed whenever the app comes back to the foreground, so a
 * phone that kept the app open overnight doesn't keep offering yesterday.
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => localDateOf(new Date()));

  useEffect(() => {
    const refresh = () => setToday(localDateOf(new Date()));
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return today;
}
