import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openJournal } from "./journal/journal.ts";
import { App } from "./ui/App.tsx";
import "./ui/styles.css";

// The server is the one the app came from; in development Vite passes its requests on.
const journal = openJournal({ server: { url: "" } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App journal={journal} />
  </StrictMode>,
);
