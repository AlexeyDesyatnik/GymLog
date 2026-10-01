import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openJournal } from "./journal/journal.ts";
import { App } from "./ui/App.tsx";
import "./ui/styles.css";

// The server is the one the app came from; in development Vite passes its requests on.
const journal = openJournal({ server: { url: "" } });

// The browser looks for a new version only when the app starts, and a phone often brings it back
// from the background instead. Looking then too, a new version installs while the app is open and
// opens the next time the app is started; no reload here (vite.config.ts).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  navigator.serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.update())
    // With no connection it is looked for again later.
    .catch(() => {});
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App journal={journal} />
  </StrictMode>,
);
