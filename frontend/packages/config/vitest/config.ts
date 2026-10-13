import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export const frozenClock = defineConfig({
    test: { setupFiles: [fileURLToPath(new URL("./frozen-clock.ts", import.meta.url))] },
});
