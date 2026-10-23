export const PORTS = {
    default: Number(process.env.CONNECT_E2E_PORT ?? "8723"),
    pseudo: Number(process.env.CONNECT_PSEUDO_E2E_PORT ?? "8726"),
};

/** A page on one Connect host (book, shop, pay or a business's slug) of an e2e server. */
export function on(host: string, path: string, server: keyof typeof PORTS = "default"): string {
    return `http://${host}.localhost:${String(PORTS[server])}${path}`;
}
