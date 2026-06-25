import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 8700, // Clientbridge web — see docs/ports.md
        strictPort: true,
        // PowerSync's OPFS SQLite requires cross-origin isolation:
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    },
    preview: { port: 8700 },
    optimizeDeps: { exclude: ["@journeyapps/wa-sqlite", "@powersync/web"] },
    worker: { format: "es" },
});
