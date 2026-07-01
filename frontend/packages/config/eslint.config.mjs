// Shared ESLint flat config for the Clientbridge frontend.
// strictTypeChecked = type-aware rules → bans `any` AND unsafe-any data flows (full type safety).
// House style: no `any`, no `console` (see [[ts-lint-format-prefs]]).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import noInlineUiString from "./no-inline-ui-string.mjs";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        plugins: { local: { rules: { "no-inline-ui-string": noInlineUiString } } },
        rules: {
            "no-console": "error",
            "@typescript-eslint/no-explicit-any": "error",
            // numbers (e.g. HTTP status codes) in template strings are fine; objects/any still banned.
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            // Keep user-facing copy in the shared `strings` catalog (see CLAUDE.md → Localization).
            // `allow` = brand/product tokens that are legitimately inline, not localizable copy.
            "local/no-inline-ui-string": ["error", { allow: ["Clientbridge", "PowerSync"] }],
        },
    },
    {
        // Debug overlays are internal dev tooling (live sync state, table row counts), not product
        // copy — exempt them from the catalog rule.
        files: ["**/Debug*.tsx"],
        rules: { "local/no-inline-ui-string": "off" },
    },
    {
        ignores: [
            "**/dist/**",
            "node_modules/**",
            "**/generated/**",
            "**/generated.ts", // the openapi-typescript output (packages/api-client/src/generated.ts)
            "**/*.cjs", // CommonJS build/codegen scripts (repo is ESM); not type-lintable
            "**/*.config.{js,ts,mjs,cjs}",
            "**/packages/config/*.mjs", // flat-config + local lint rules — tooling, not in any tsconfig
        ],
    },
);
