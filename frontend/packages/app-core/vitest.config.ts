import { frozenClock } from "@clientbridge/config/vitest/config";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
    frozenClock,
    defineConfig({ test: { setupFiles: ["./vitest.setup.ts"] } }),
);
