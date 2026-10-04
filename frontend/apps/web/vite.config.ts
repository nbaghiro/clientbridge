import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 8700, // Clientbridge web — see docs/ports.md
        strictPort: true,
    },
    preview: { port: 8700 },
    optimizeDeps: { exclude: ["@journeyapps/wa-sqlite", "@powersync/web"] },
    worker: { format: "es" },
});
