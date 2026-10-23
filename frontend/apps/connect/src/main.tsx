import React from "react";
import { activeLocale, setPseudoLocale } from "@clientbridge/app-core/public";
import { configureStripe } from "@clientbridge/ui";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { isEmbedded } from "./embed";
import "./index.css";
import { config } from "./config";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Flag embed mode on <html> before first paint so the CSS can drop the full-screen chrome.
if (isEmbedded()) document.documentElement.setAttribute("data-embed", "");

configureStripe(config.stripePublishableKey);

// pages set their own scroll (top, or a #section), which the browser's restore after a back would undo
window.history.scrollRestoration = "manual";

const render = (): void => {
    document.documentElement.lang = activeLocale();
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
};

if (config.pseudoLocale) setPseudoLocale(true).then(render, render);
else render();
