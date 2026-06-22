/* eslint-disable react-refresh/only-export-components */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FailureView from "./views/FailureView";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

// Path-based "routing" — the SPA only needs two entries today (index + the
// `/failure` view from #0035), so a switch on `pathname` is simpler than
// pulling in react-router.
function Root() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (
    path === "/failure" ||
    path.startsWith("/failure/") ||
    hash.startsWith("#/failure") ||
    hash.startsWith("#/share")
  ) {
    return <FailureView />;
  }
  return <App />;
}

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
