import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openJournal } from "./journal/journal.ts";
import { App } from "./ui/App.tsx";
import "./ui/styles.css";

const journal = openJournal();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App journal={journal} />
  </StrictMode>,
);
