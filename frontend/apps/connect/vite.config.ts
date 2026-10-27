import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { runtimeConfig } from "@clientbridge/config/vite/runtime-config";
import { defineConfig } from "vite";

// No cross-origin-isolation headers, so businesses can embed these pages in their own sites.
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        runtimeConfig(["apiUrl", "pageUrl", "bookUrl", "shopUrl", "payUrl"]),
    ],
    server: {
        port: 8709, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8709 },
});
