import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Collected for automated screenshot checks (docs/capture.py)
(window as any).__errors = [];
window.addEventListener("error", e => (window as any).__errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => (window as any).__errors.push(String(e.reason)));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
