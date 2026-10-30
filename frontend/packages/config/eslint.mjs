// Shared flat config: strictTypeChecked bans `any` and unsafe-any data flows.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import noComposedCopy from "./no-composed-copy.mjs";
import noErrorMessageCopy from "./no-error-message-copy.mjs";
import noHandPlural from "./no-hand-plural.mjs";
import noInlineUiString from "./no-inline-ui-string.mjs";
import noModuleScopeCopy from "./no-module-scope-copy.mjs";
import noRawFormat from "./no-raw-format.mjs";

const readonly = (names) => Object.fromEntries(names.map((name) => [name, "readonly"]));
const NODE_GLOBALS = readonly(["console", "process", "URL", "setTimeout", "clearTimeout"]);
const COMMONJS_GLOBALS = {
    ...readonly(["require", "__dirname", "__filename"]),
    module: "writable",
};
const MAESTRO_GLOBALS = {
    ...readonly(["http", "json", "maestro", "encodeURIComponent", "EMAIL", "PASSWORD"]),
    // what the native lane passes every flow, and the control helper's own arguments
    ...readonly([
        "E2E_NAMESPACE",
        "MAILPIT_URL",
        "AUTH_ADMIN_URL",
        "AUTH_URL",
        "CONTROL_URL",
        "ACTION",
        "PAYLOAD",
    ]),
    output: "writable",
};

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
        ignores: ["**/*.test.{ts,tsx}", "**/Debug*.tsx", "**/packages/app-core/src/debug.ts"],
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
        // WebKit keeps a script-navigated page's replica locks, so full-page navigations close it first.
        files: ["**/apps/web/src/**/*.{ts,tsx}"],
        ignores: ["**/apps/web/src/lib/powersync.ts", "**/apps/web/src/AdminLogin.tsx"],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "CallExpression[callee.property.name=/^(assign|replace|reload)$/][callee.object.name='location'], CallExpression[callee.property.name=/^(assign|replace|reload)$/][callee.object.property.name='location'], AssignmentExpression[left.property.name='href'][left.object.name='location'], AssignmentExpression[left.property.name='href'][left.object.property.name='location'][left.object.object.name='window']",
                    message:
                        "Navigate with leave() from lib/powersync, which closes the replica first.",
                },
            ],
        },
    },
    {
        // Param lists stay `type`s: an interface needs an index signature to satisfy ParamListBase.
        files: ["**/apps/mobile/src/navigation.ts"],
        rules: { "@typescript-eslint/consistent-type-definitions": "off" },
    },
    {
        // The site prerenders one locale per build process, so its content modules may read the catalog once.
        files: ["**/apps/site/src/**/*.{ts,tsx}"],
        rules: { "local/no-module-scope-copy": "off" },
    },
    {
        // Debug overlays and the facts they share are dev tooling, not product copy.
        files: ["**/Debug*.tsx", "**/packages/app-core/src/debug.ts"],
        rules: {
            "local/no-composed-copy": "off",
            "local/no-error-message-copy": "off",
            "local/no-inline-ui-string": "off",
            "local/no-raw-format": "off",
        },
    },
    {
        // Tests, e2e suites (fixture data) and the storage bench are not product copy.
        files: ["**/*.test.{ts,tsx}", "**/e2e/**/*.ts", "**/packages/sync/bench/*.ts"],
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
        // JavaScript files sit in no tsconfig, so they get every rule that needs no type information.
        files: ["**/*.{js,mjs,cjs}"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { globals: NODE_GLOBALS },
    },
    {
        files: ["**/*.cjs", "**/apps/mobile/{babel,metro}.config.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: { ...NODE_GLOBALS, ...COMMONJS_GLOBALS },
        },
        rules: { "@typescript-eslint/no-require-imports": "off" },
    },
    {
        // Maestro runs these helpers in its own JavaScript engine, with its globals and flow variables.
        files: ["**/apps/mobile/e2e/**/*.js"],
        languageOptions: { sourceType: "script", globals: MAESTRO_GLOBALS },
    },
    {
        ignores: [
            "**/dist/**",
            "**/dist-server/**",
            "**/playwright-report/**",
            "**/test-results/**",
            "node_modules/**",
            "**/apps/connect/public/embed.js", // generated by make gen-strings from src/embedLoader.ts
            "**/packages/api-client/src/generated.ts", // generated by make gen-api
            "**/apps/mobile/{ios,android}/**", // native projects generated by `expo prebuild`
            "**/.expo/**",
        ],
    },
);
