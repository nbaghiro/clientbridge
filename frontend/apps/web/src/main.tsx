const dbgStart = performance.now();
const dbgTimer = setInterval(() => {
    navigator.locks.query().then((q) => { console.error("DBGLOCKS", performance.now().toFixed(0), JSON.stringify({ held: q.held?.map((l) => [l.name, l.mode, l.clientId]), pending: q.pending?.map((l) => [l.name, l.mode, l.clientId]) })); }).catch((e) => { console.error("DBGLOCKS failed", String(e)); });
    if (performance.now() - dbgStart > 40000) clearInterval(dbgTimer);
}, 1000);
window.addEventListener("error", (e) => { console.error("DBGERR", e.message); });
window.addEventListener("unhandledrejection", (e) => { console.error("DBGREJ", String(e.reason)); });
window.addEventListener("pagehide", (e) => { console.error("DBGPAGEHIDE", e.persisted); });
import React from "react";
import { activeLocale, setMediaBase, setPseudoLocale } from "@clientbridge/app-core";
import { configureStripe } from "@clientbridge/ui";
import ReactDOM from "react-dom/client";
import { AdminLogin } from "./AdminLogin";
import { App } from "./App";
import { config } from "./config";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

configureStripe(config.stripePublishableKey);
setMediaBase(config.apiUrl);

const render = (): void => {
    document.documentElement.lang = activeLocale();
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            {window.location.pathname === "/admin-login" ? <AdminLogin /> : <App />}
        </React.StrictMode>,
    );
};

if (config.pseudoLocale) setPseudoLocale(true).then(render, render);
else render();

if (import.meta.env.PROD && "serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
