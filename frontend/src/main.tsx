/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useEffect, useState } from "react";
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
  const [currentPath, setCurrentPath] = useState(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );
  const [currentHash, setCurrentHash] = useState(
    typeof window !== "undefined" ? window.location.hash : ""
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleNavigation = () => {
      setCurrentPath(window.location.pathname);
      setCurrentHash(window.location.hash);
    };
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
    };
  }, []);

  if (
    currentPath === "/failure" ||
    currentPath.startsWith("/failure/") ||
    currentHash.startsWith("#/failure") ||
    currentHash.startsWith("#/share")
  ) {
    return <FailureView key={currentPath + currentHash} />;
  }
  return <App />;
}

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

