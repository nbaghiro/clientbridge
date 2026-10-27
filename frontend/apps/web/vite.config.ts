import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { runtimeConfig } from "@clientbridge/config/vite/runtime-config";
import { defineConfig } from "vite";
import { precacheAssets } from "./scripts/precache";

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        runtimeConfig([
            "adminUrl",
            "apiUrl",
            "authUrl",
            "syncUrl",
            "pageUrl",
            "bookUrl",
            "shopUrl",
            "payUrl",
        ]),
        {
            name: "offline-shell",
            apply: "build",
            generateBundle(_, bundle) {
                const assets = precacheAssets(Object.keys(bundle));
                const revision = createHash("sha256")
                    .update(JSON.stringify(assets))
                    .digest("hex")
                    .slice(0, 16);
                const worker = readFileSync(
                    new URL("./scripts/service-worker.js", import.meta.url),
                    "utf8",
                )
                    .replace("const ASSETS = [];", `const ASSETS = ${JSON.stringify(assets)};`)
                    .replace(
                        '"clientbridge-shell"',
                        JSON.stringify(`clientbridge-shell-${revision}`),
                    );
                this.emitFile({ type: "asset", fileName: "sw.js", source: worker });
            },
        },
    ],
    server: {
        port: 8700, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8700 },
    optimizeDeps: { exclude: ["@journeyapps/wa-sqlite", "@powersync/web"] },
    worker: { format: "es" },
});
