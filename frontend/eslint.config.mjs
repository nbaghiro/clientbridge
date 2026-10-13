// Root flat config: `eslint .` over every app and package; TypeScript files resolve their tsconfig.
import config from "@clientbridge/config/eslint";

export default [
    ...config,
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
