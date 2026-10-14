import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// Collected for automated screenshot checks (docs/capture.py)
(window as any).__errors = [];
window.addEventListener("error", e => (window as any).__errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => (window as any).__errors.push(String(e.reason)));

// "/" is the landing page; "/console" is the clinician console. Older deep links such as
// "/?patient=HT-0278" or "/?view=live" still open the console.
const path = window.location.pathname.replace(/\/+$/, "");
const params = new URLSearchParams(window.location.search);
const isConsole = path === "/console" || params.has("patient") || params.has("view");

const Page = isConsole ? lazy(() => import("./App")) : lazy(() => import("./landing/Landing"));
if (isConsole) document.title = "HridayTwin console";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </React.StrictMode>,
);
