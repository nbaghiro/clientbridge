import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

// the variables the web image's Caddy serves as /config.js, under the same names
const SERVED = {
    baseDomain: "BASE_DOMAIN",
    webUrl: "APP_URL",
    adminUrl: "ADMIN_URL",
    apiUrl: "API_URL",
    authUrl: "AUTH_URL",
    syncUrl: "SYNC_URL",
    pageUrl: "PAGE_URL",
    bookUrl: "BOOK_URL",
    shopUrl: "SHOP_URL",
    payUrl: "PAY_URL",
    stripePublishableKey: "STRIPE_PUBLISHABLE_KEY",
} as const;

type Served = keyof typeof SERVED;

/** The config.js script for an environment, failing on a value the app needs that is missing. */
export function configScript(env: Record<string, string>, needs: readonly Served[]): string {
    const values = Object.fromEntries(
        Object.entries(SERVED).map(([key, name]) => [key, env[name] ?? ""]),
    );
    const missing = needs.filter((key) => values[key] === "" && values.baseDomain === "");
    if (missing.length > 0) {
        const names = missing.map((key) => SERVED[key]).join(", ");
        throw new Error(`set ${names} or BASE_DOMAIN to serve /config.js`);
    }
    return `window.__CLIENTBRIDGE_CONFIG__ = ${JSON.stringify(values)};\n`;
}

/** Serves /config.js from the environment in dev and preview, as Caddy does in the web image. */
export function runtimeConfig(needs: readonly Served[]): Plugin {
    let env: Record<string, string> = {};
    const serve = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        if (request.url?.split("?")[0] !== "/config.js") {
            next();
            return;
        }
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(configScript(env, needs));
    };
    return {
        name: "runtime-config",
        configResolved(config) {
            env = loadEnv(config.mode, config.envDir, "");
        },
        configureServer(server) {
            configScript(env, needs);
            server.middlewares.use(serve);
        },
        configurePreviewServer(server) {
            configScript(env, needs);
            server.middlewares.use(serve);
        },
    };
}
