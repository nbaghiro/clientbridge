import { fileURLToPath } from "node:url";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../../packages");
const MOBILE_SRC = `${path.join(here, "src/mobile")}${path.sep}`;
const UI_MOBILE = path.join(packages, "ui/src/mobile/index.ts");

// Files under src/mobile get the React Native entry of @clientbridge/ui, the way Metro picks it.
function mobileEntry(): Plugin {
    return {
        name: "playground-mobile-entry",
        enforce: "pre",
        resolveId(source, importer) {
            if (source === "@clientbridge/ui" && importer?.startsWith(MOBILE_SRC)) return UI_MOBILE;
            return null;
        },
    };
}

export default defineConfig({
    plugins: [mobileEntry(), react(), tailwindcss()],
    resolve: {
        alias: [
            { find: /^react-native$/, replacement: "react-native-web" },
            {
                find: /^@stripe\/stripe-react-native$/,
                replacement: path.join(here, "src/mobile/StripeStub.tsx"),
            },
            {
                find: /^@clientbridge\/tokens\/native$/,
                replacement: path.join(here, "src/mobile/nativeTheme.ts"),
            },
        ],
        extensions: [
            ".web.tsx",
            ".web.ts",
            ".web.js",
            ".tsx",
            ".ts",
            ".jsx",
            ".js",
            ".mjs",
            ".json",
        ],
        dedupe: ["react", "react-dom"],
    },
    // React Native Web's animation cleanup still uses the native global alias.
    define: { global: "globalThis", __DEV__: "false", "process.env.EXPO_OS": '"web"' },
    optimizeDeps: {
        include: ["react-native-web", "react-native-svg", "react-native-safe-area-context"],
        exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
        rolldownOptions: {
            resolve: {
                extensions: [
                    ".web.tsx",
                    ".web.ts",
                    ".web.js",
                    ".tsx",
                    ".ts",
                    ".jsx",
                    ".js",
                    ".mjs",
                    ".json",
                ],
            },
        },
    },
    server: {
        port: 8712, // see .docs/engineering.md (ports)
        strictPort: true,
    },
    preview: { port: 8712 },
});
