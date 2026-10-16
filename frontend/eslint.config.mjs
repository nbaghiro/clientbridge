// Root flat config: `eslint .` over every app and package; TypeScript files resolve their tsconfig.
import config from "@clientbridge/config/eslint";

export default [
    ...config,
    {
        files: ["apps/web/scripts/service-worker.js"],
        languageOptions: {
            globals: {
                self: "readonly",
                caches: "readonly",
                fetch: "readonly",
                Response: "readonly",
            },
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
