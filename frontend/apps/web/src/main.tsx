import React from "react";
import { configureStripe } from "@clientbridge/ui";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { config } from "./config";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

configureStripe(config.stripePublishableKey);

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
