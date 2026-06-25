// Shared ESLint flat config for the Clientbridge frontend.
// strictTypeChecked = type-aware rules → bans `any` AND unsafe-any data flows (full type safety).
// House style: no `any`, no `console` (see [[ts-lint-format-prefs]]).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        rules: {
            "no-console": "error",
            "@typescript-eslint/no-explicit-any": "error",
            // numbers (e.g. HTTP status codes) in template strings are fine; objects/any still banned.
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        },
    },
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "**/generated/**",
            "**/*.config.{js,ts,mjs,cjs}",
        ],
    },
);
