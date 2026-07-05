import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Clientbridge Connect — the customer-facing surfaces (booking, pay, form, contract, review).
// Deliberately NO cross-origin-isolation headers: unlike apps/web this app has no PowerSync/OPFS
// SQLite, and dropping COEP keeps it embeddable in a business's own site.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 8709, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8709 },
});
