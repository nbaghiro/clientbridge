import { runPort } from "@clientbridge/config/e2e/run";
export const PORTS = {
    default: runPort("CONNECT_E2E_PORT"),
    pseudo: runPort("CONNECT_PSEUDO_E2E_PORT"),
};

/** A page on one Connect host (book, shop, pay or a business's slug) of an e2e server. */
export function on(host: string, path: string, server: keyof typeof PORTS = "default"): string {
    return `http://${host}.localhost:${String(PORTS[server])}${path}`;
}
