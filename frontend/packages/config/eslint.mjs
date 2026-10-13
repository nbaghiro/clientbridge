// Shared flat config: strictTypeChecked bans `any` and unsafe-any data flows.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import noComposedCopy from "./no-composed-copy.mjs";
import noErrorMessageCopy from "./no-error-message-copy.mjs";
import noHandPlural from "./no-hand-plural.mjs";
import noInlineUiString from "./no-inline-ui-string.mjs";
import noModuleScopeCopy from "./no-module-scope-copy.mjs";
import noRawFormat from "./no-raw-format.mjs";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        // Inline eslint comments are ignored and reported, so a rule can only change here.
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: "error",
            reportUnusedInlineConfigs: "error",
        },
        plugins: {
            local: {
                rules: {
                    "no-composed-copy": noComposedCopy,
                    "no-error-message-copy": noErrorMessageCopy,
                    "no-hand-plural": noHandPlural,
                    "no-inline-ui-string": noInlineUiString,
                    "no-module-scope-copy": noModuleScopeCopy,
                    "no-raw-format": noRawFormat,
                },
            },
        },
        rules: {
            "no-console": "error",
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@powersync/react",
                            importNames: ["useStatus"],
                            message:
                                "Use useSyncStatus from app-core: useStatus misses a status change that lands before it subscribes.",
                        },
                    ],
                },
            ],
            // Ban `void`; ignoreVoid:false so a floating promise needs a real .catch/await, not void.
            "no-void": "error",
            "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/ban-ts-comment": [
                "error",
                {
                    "ts-expect-error": true,
                    "ts-ignore": true,
                    "ts-nocheck": true,
                    "ts-check": false,
                },
            ],
            // Numbers in template strings are fine; objects and any are still banned.
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            "local/no-composed-copy": "error",
            "local/no-error-message-copy": "error",
            "local/no-hand-plural": "error",
            "local/no-inline-ui-string": "error",
            "local/no-module-scope-copy": "error",
            "local/no-raw-format": "error",
        },
    },
    {
        // Composition checks apply where text is rendered, not in scripts, sync or the API client.
        ignores: ["**/apps/*/src/**", "**/packages/ui/src/**", "**/packages/app-core/src/**"],
        rules: { "local/no-composed-copy": "off" },
    },
    {
        // Where text is rendered, every prose literal is copy unless its type says it is an identifier.
        files: [
            "**/apps/*/src/**/*.{ts,tsx}",
            "**/packages/ui/src/**/*.{ts,tsx}",
            "**/packages/app-core/src/**/*.{ts,tsx}",
        ],
        ignores: ["**/*.test.{ts,tsx}", "**/Debug*.tsx"],
        rules: { "local/no-inline-ui-string": ["error", { literals: true }] },
    },
    {
        // Generated demo data, partner brands and photo credits are names, not copy.
        files: [
            "**/apps/site/src/content/demo-snapshot.ts",
            "**/apps/site/src/content/brands.ts",
            "**/apps/site/src/content/photos.ts",
        ],
        rules: { "local/no-inline-ui-string": ["error", { literals: false }] },
    },
    {
        // The formatter is the one place that calls Intl and names locales.
        files: [
            "**/packages/app-core/src/format.ts",
            "**/packages/app-core/src/datetime.ts",
            "**/packages/app-core/src/locale.ts",
        ],
        rules: { "local/no-raw-format": "off", "local/no-composed-copy": "off" },
    },
    {
        // Navigation param lists stay `type`s: an interface would need an index signature to satisfy ParamListBase.
        files: ["**/apps/mobile/src/navigation.ts"],
        rules: { "@typescript-eslint/consistent-type-definitions": "off" },
    },
    {
        // Signature strokes are SVG path coordinates, not displayed numbers.
        files: ["**/SignaturePad.tsx"],
        rules: { "local/no-raw-format": "off" },
    },
    {
        // The site prerenders one locale per build process, so its content modules may read the catalog once.
        files: ["**/apps/site/src/**/*.{ts,tsx}"],
        rules: { "local/no-module-scope-copy": "off" },
    },
    {
        // Debug overlays are dev tooling, not product copy.
        files: ["**/Debug*.tsx"],
        rules: {
            "local/no-composed-copy": "off",
            "local/no-error-message-copy": "off",
            "local/no-inline-ui-string": "off",
            "local/no-raw-format": "off",
        },
    },
    {
        // Tests and e2e suites (fixture data) are not product copy.
        files: ["**/*.test.{ts,tsx}", "**/e2e/**/*.ts"],
        rules: {
            "local/no-composed-copy": "off",
            "local/no-error-message-copy": "off",
            "local/no-hand-plural": "off",
            "local/no-module-scope-copy": "off",
            "local/no-raw-format": "off",
        },
    },
    {
        // Connect and app-core/public must never pull the PowerSync replica stack into the customer bundle.
        files: [
            "**/apps/connect/src/**/*.{ts,tsx}",
            "**/packages/app-core/src/public.ts",
            "**/packages/app-core/src/domain/public*.ts",
        ],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["@powersync/*", "@clientbridge/sync"],
                            message:
                                "PowerSync must not reach the Connect bundle — keep this file on the app-core/public (PowerSync-free) surface.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // Web UI is used by Connect too, so it stays on the PowerSync-free surface and off React Native.
        files: ["**/packages/ui/src/web/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@clientbridge/app-core",
                            message: "Import from @clientbridge/app-core/public in shared UI.",
                        },
                    ],
                    patterns: [
                        { group: ["@powersync/*", "@clientbridge/sync"] },
                        {
                            group: [
                                "react-native",
                                "react-native-*",
                                "@stripe/stripe-react-native",
                            ],
                            message: "React Native belongs in packages/ui/src/mobile.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["**/packages/ui/src/mobile/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    patterns: [
                        { group: ["@powersync/*", "@clientbridge/sync"] },
                        {
                            group: [
                                "react-dom",
                                "react-dom/*",
                                "@stripe/stripe-js",
                                "@stripe/react-stripe-js",
                            ],
                            message: "DOM code belongs in packages/ui/src/web.",
                        },
                    ],
                },
            ],
        },
    },
    {
        ignores: [
            "**/dist/**",
            "**/playwright-report/**",
            "**/test-results/**",
            "**/public/**", // static assets served as-is (e.g. the vanilla embed loader)
            "node_modules/**",
            "**/generated.ts", // the openapi-typescript output (packages/api-client/src/generated.ts)
            "**/*.cjs", // CommonJS build/codegen scripts (repo is ESM); not type-lintable
            "**/*.config.{js,ts,mjs,cjs}",
            "**/packages/config/**/*.mjs", // flat config, lint rules and the structure check: tooling, in no tsconfig
            "**/apps/mobile/{ios,android}/**", // native projects generated by `expo prebuild`
            "**/apps/mobile/e2e/**/*.js", // Maestro runScript helpers, run by Maestro's own JS engine
            "**/.expo/**",
        ],
    },
);
