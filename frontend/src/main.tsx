/* eslint-disable react-refresh/only-export-components */
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import BootSplash from "./components/BootSplash";
import { isBlockGalleryDebugRoute, isFailureOrShareRoute } from "./routing";
import "./index.css";

const App = lazy(() => import("./App"));
const FailureView = lazy(() => import("./views/FailureView"));
const BlockGallery = lazy(() => import("./world/__debug__/BlockGallery"));

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

  if (isBlockGalleryDebugRoute()) {
    return (
      <Suspense fallback={<BootSplash message="Loading block gallery…" />}>
        <div className="h-screen w-screen">
          <BlockGallery />
        </div>
      </Suspense>
    );
  }
  if (isFailureOrShareRoute(currentPath, currentHash)) {
    return (
      <Suspense fallback={<BootSplash />}>
        <FailureView key={currentPath + currentHash} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<BootSplash />}>
      <App />
    </Suspense>
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
