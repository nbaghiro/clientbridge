import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-raw-format.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("no-raw-format", rule, {
    valid: ["formatMoney(cents, currency);", "name.toLocaleLowerCase();", 'const key = "en_CA";'],
    invalid: [
        { code: "date.toLocaleDateString();", errors: [{ messageId: "toLocale" }] },
        { code: "n.toLocaleString();", errors: [{ messageId: "toLocale" }] },
        { code: "new Intl.NumberFormat();", errors: [{ messageId: "intl" }] },
        { code: "Intl.DateTimeFormat().resolvedOptions();", errors: [{ messageId: "intl" }] },
        { code: "const shown = rate.toFixed(1);", errors: [{ messageId: "toFixed" }] },
        { code: 'const tag = "en-CA";', errors: [{ messageId: "tag" }] },
        { code: 'format(value, "fr-CA");', errors: [{ messageId: "tag" }] },
    ],
});
