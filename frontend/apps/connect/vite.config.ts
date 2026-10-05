import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No cross-origin-isolation headers, so businesses can embed these pages in their own sites.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 8709, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8709 },
});
