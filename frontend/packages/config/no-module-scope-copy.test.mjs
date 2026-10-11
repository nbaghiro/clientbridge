import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-module-scope-copy.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
            projectService: { allowDefaultProject: ["src/*.ts"] },
            tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
        },
    },
});

// The rule recognises the catalog by its declaring file, so each case is written as src/strings.ts.
const catalog = `interface Strings {
    readonly billing: { readonly paid: string; readonly days: readonly [string, string]; readonly due: (n: number) => string };
}
declare const strings: Strings;
`;
const filename = "src/strings.ts";

tester.run("no-module-scope-copy", rule, {
    valid: [
        { code: `${catalog} const s = strings.billing;`, filename },
        { code: `${catalog} export function label(): string { return strings.billing.paid; }`, filename },
        { code: `${catalog} const labels = { get paid() { return strings.billing.paid; } };`, filename },
        { code: `${catalog} const due = strings.billing.due;`, filename },
        { code: `${catalog} const pick = (): string => strings.billing.due(2);`, filename },
    ],
    invalid: [
        { code: `${catalog} const PAID = strings.billing.paid;`, filename, errors: [{ messageId: "read" }] },
        {
            code: `${catalog} const s = strings.billing; export const OPTIONS = [{ label: s.paid }];`,
            filename,
            errors: [{ messageId: "read" }],
        },
        { code: `${catalog} const DAYS = strings.billing.days;`, filename, errors: [{ messageId: "read" }] },
        { code: `${catalog} const DUE = strings.billing.due(3);`, filename, errors: [{ messageId: "read" }] },
    ],
});
