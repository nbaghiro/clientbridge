import React from "react";
import ReactDOM from "react-dom/client";
import { activeLocale, setPseudoLocale } from "@clientbridge/app-core/public";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
document.documentElement.dataset.surface = "admin";
const render = (): void => {
    document.documentElement.lang = activeLocale();
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
};
if (import.meta.env.VITE_PSEUDO_LOCALE === "1") setPseudoLocale(true).then(render, render);
else render();
