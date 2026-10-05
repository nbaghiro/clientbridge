import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const routePath = (req: IncomingMessage): string | null => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    return path === "/" || /\.[a-z0-9]+$/i.test(path) ? null : path.replace(/\/+$/, "");
};

// Serves clean URLs (/solutions) locally the way the static host will.
const cleanUrls = (): Plugin => ({
    name: "clean-urls",
    configureServer(server) {
        server.middlewares.use((req, _res, next) => {
            if (routePath(req) !== null) req.url = "/index.html";
            next();
        });
    },
    configurePreviewServer(server) {
        const dist = join(server.config.root, server.config.build.outDir);
        server.middlewares.use((req, res, next) => {
            const path = routePath(req);
            if (path === null) {
                next();
            } else if (existsSync(join(dist, path, "index.html"))) {
                req.url = `${path}/index.html`;
                next();
            } else {
                res.statusCode = 404;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(readFileSync(join(dist, "404.html")));
            }
        });
    },
});

export default defineConfig({
    plugins: [react(), tailwindcss(), cleanUrls()],
    appType: "mpa",
    server: {
        port: 8710, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8710, strictPort: true },
    // Workspace packages ship TypeScript source, so the SSR build bundles them instead of importing.
    ssr: { noExternal: [/^@clientbridge\//] },
});
