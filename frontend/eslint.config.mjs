// Root flat config — runs `eslint .` over every app/package with type-aware rules.
// projectService auto-resolves each package's tsconfig for the strictTypeChecked rules.
import config from "@clientbridge/config/eslint";

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
