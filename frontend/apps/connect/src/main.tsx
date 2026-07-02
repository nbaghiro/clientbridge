import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { isEmbedded } from "./embed";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Flag embed mode on <html> before first paint so the CSS can drop the full-screen chrome.
if (isEmbedded()) document.documentElement.setAttribute("data-embed", "");

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
