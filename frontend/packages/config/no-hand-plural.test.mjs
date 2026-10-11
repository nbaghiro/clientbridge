import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-hand-plural.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
            projectService: { allowDefaultProject: ["*.ts"] },
            tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
        },
    },
});

const header = "declare const count: number; declare const row: { active: number };";

tester.run("no-hand-plural", rule, {
    valid: [
        { code: `${header} const label = row.active === 1 ? "" : "opacity-60";`, filename: "a.ts" },
        { code: `${header} const total = count === 1 ? 10 : 20;`, filename: "a.ts" },
        { code: `${header} const word = count === 2 ? "pair" : "many";`, filename: "a.ts" },
    ],
    invalid: [
        {
            code: `${header} const label = count === 1 ? "visit" : "visits";`,
            filename: "a.ts",
            errors: [{ messageId: "plural" }],
        },
        {
            code: `${header} declare const items: string[]; const label = items.length !== 1 ? "items" : "item";`,
            filename: "a.ts",
            errors: [{ messageId: "plural" }],
        },
        {
            code: `${header} declare const one: (n: number) => string; declare const many: (n: number) => string; const f = count === 1 ? one : many;`,
            filename: "a.ts",
            errors: [{ messageId: "plural" }],
        },
    ],
});
