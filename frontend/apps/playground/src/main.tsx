import { activeLocale, setPseudoLocale } from "@clientbridge/app-core/public";
import { type ComponentType, StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { parseHash } from "./routes";
import { App } from "./web/App";

const frames = import.meta.glob<{ default: ComponentType<{ hash: string }> }>("./mobile/Frame.tsx");
const MobileFrame = lazy(async () => {
    const load = Object.values(frames)[0];
    if (!load) throw new Error("mobile frame missing");
    return load();
});

function Root() {
    const [hash, setHash] = useState(window.location.hash);
    useEffect(() => {
        const on = (): void => {
            setHash(window.location.hash);
        };
        window.addEventListener("hashchange", on);
        return () => {
            window.removeEventListener("hashchange", on);
        };
    }, []);
    const route = parseHash(hash);
    if (route.kind === "frame") {
        return (
            <Suspense fallback={null}>
                <MobileFrame hash={hash} />
            </Suspense>
        );
    }
    return <App route={route} />;
}

// React Native runs without StrictMode, and react-native-web's Modal portal detaches under its double effects.
const isFrame = window.location.hash.startsWith("#/frame/");
const root = document.getElementById("root");

function render(): void {
    document.documentElement.lang = activeLocale();
    if (!root) return;
    createRoot(root).render(
        isFrame ? (
            <Root />
        ) : (
            <StrictMode>
                <Root />
            </StrictMode>
        ),
    );
}

if (import.meta.env.VITE_PSEUDO_LOCALE === "1") setPseudoLocale(true).then(render, render);
else render();
