import "./styles/site.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { routeFor } from "./routes";

// Dev only: production pages are pre-rendered static HTML and ship without this script.
const container = document.getElementById("root");
if (container) {
    const route = routeFor(window.location.pathname);
    document.title = route.meta.title;
    createRoot(container).render(
        <StrictMode>
            <App route={route} />
        </StrictMode>,
    );
}
