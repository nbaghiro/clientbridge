import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Clientbridge marketing site. Built to static HTML per route (scripts/prerender.ts), deployed apart
// from the web app; it shares the theme and logo through @clientbridge/tokens and @clientbridge/ui.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    appType: "mpa",
    server: {
        port: 8710, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8710, strictPort: true },
    // Workspace packages ship TypeScript source, so the SSR build bundles them instead of importing.
    ssr: { noExternal: [/^@clientbridge\//] },
});
