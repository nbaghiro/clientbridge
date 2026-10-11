import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-inline-ui-string.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
}).run("no-inline-ui-string", rule, {
    valid: [
        "const a = <p>{strings.billing.paid}</p>;",
        'const a = <p className="text-sm">{" · "}</p>;',
        'const a = <img alt="" />;',
        'close.textContent = "×";',
        'launch.setAttribute("aria-expanded", "false");',
        "heading.textContent = text.title;",
        'const a = <Icon name="check" />;',
    ],
    invalid: [
        { code: "const a = <p>Save changes</p>;", errors: [{ messageId: "jsx" }] },
        { code: 'const a = <p>{ok ? "Saved" : null}</p>;', errors: [{ messageId: "jsx" }] },
        { code: 'const a = <button aria-label="Close" />;', errors: [{ messageId: "attr" }] },
        { code: 'setError("Something went wrong");', errors: [{ messageId: "sink" }] },
        { code: 'const o = { errorMessage: "Try again" };', errors: [{ messageId: "sink" }] },
        { code: 'heading.textContent = "Book online";', errors: [{ messageId: "sink" }] },
        { code: 'dialog.setAttribute("aria-label", "Booking");', errors: [{ messageId: "sink" }] },
    ],
});
