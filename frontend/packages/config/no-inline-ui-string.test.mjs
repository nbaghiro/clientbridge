import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-inline-ui-string.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const typed = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
            ecmaFeatures: { jsx: true },
            projectService: { allowDefaultProject: ["*.tsx"] },
            tsconfigRootDir: import.meta.dirname,
        },
    },
});

const literals = [{ literals: true }];
const prelude =
    'declare function Button(p: { label: string; variant?: "outline" | "quiet" }): null;\n';

typed.run("no-inline-ui-string literals", rule, {
    valid: [
        {
            code: `${prelude}const a = <Button label={strings.clients.save} variant="outline" />;`,
            options: literals,
        },
        { code: 'const k = (e: { key: string }) => e.key === "Escape";', options: literals },
        {
            code: 'const c = cx("flex items-center gap-2", on && "bg-accent text-accent-ink");',
            options: literals,
        },
        { code: 'const tone = { danger: "bg-danger-bg text-danger-fg" };', options: literals },
        { code: "const q = `SELECT name FROM clients WHERE id = ?`;", options: literals },
        { code: 'const cols = "id, user_id, name";', options: literals },
        {
            code: 'type Route = "Payments" | "Clients"; const r: Route = "Payments";',
            options: literals,
        },
        { code: 'throw new Error("session initialization timed out");', options: literals },
        { code: 'import x from "Some Module";', options: literals },
        { code: 'const z = { zone: "America/Vancouver", path: "/inbox" };', options: literals },
        { code: 'nav.navigate("Payments");', options: literals },
        { code: 'const s = { label: "Save changes" };' },
    ],
    invalid: [
        {
            code: `${prelude}const a = <Button label="Save" />;`,
            options: literals,
            errors: [{ messageId: "literal" }],
        },
        {
            code: 'Alert.alert("Delete client?", "This cannot be undone");',
            options: literals,
            errors: [{ messageId: "literal" }, { messageId: "literal" }],
        },
        {
            code: 'const o = { title: "Clients", headerTitle: "Client detail" };',
            options: literals,
            errors: [{ messageId: "literal" }, { messageId: "literal" }],
        },
        {
            code: 'const m = "Saved changes";',
            options: literals,
            errors: [{ messageId: "literal" }],
        },
        {
            code: "const t = (n: number) => `${String(n)} items left`;",
            options: literals,
            errors: [{ messageId: "literal" }],
        },
        {
            code: 'const a = <p aria-label={on ? "Open menu" : "Close menu"} />;',
            options: literals,
            errors: [{ messageId: "literal" }, { messageId: "literal" }],
        },
        {
            code: 'Share.share({ message: "Book with us" });',
            options: literals,
            errors: [{ messageId: "literal" }],
        },
    ],
});

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
