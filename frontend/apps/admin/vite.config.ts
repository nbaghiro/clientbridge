import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { runtimeConfig } from "@clientbridge/config/vite/runtime-config";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss(), runtimeConfig(["apiUrl", "webUrl"])],
    server: { port: 8711, strictPort: true },
    preview: { port: 8711, strictPort: true },
});
