import React from "react";
import { activeLocale, setPseudoLocale } from "@clientbridge/app-core";
import { configureStripe } from "@clientbridge/ui";
import ReactDOM from "react-dom/client";
import { AdminLogin } from "./AdminLogin";
import { App } from "./App";
import { config } from "./config";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

configureStripe(config.stripePublishableKey);

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
