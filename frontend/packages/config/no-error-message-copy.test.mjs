import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-error-message-copy.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
}).run("no-error-message-copy", rule, {
    valid: [
        "try { run(); } catch (e) { setError(failureMessage(e, fallback)); }",
        "try { run(); } catch (e) { log(e.message); }",
        "load().catch((e) => { if (e.message === 'gone') retry(); });",
        "function show(note) { setError(note.message); }",
        "const isFull = (error) => error instanceof Error && FULL.test(error.message);",
    ],
    invalid: [
        {
            code: "try { run(); } catch (e) { setError(e instanceof Error ? e.message : fallback); }",
            errors: [{ messageId: "message" }],
        },
        {
            code: "load().catch((err) => { toast(err.message); });",
            errors: [{ messageId: "message" }],
        },
        {
            code: "load().then(ok, (err) => ({ error: err.message }));",
            errors: [{ messageId: "message" }],
        },
        {
            code: "try { run(); } catch (e) { view = <p>{e.message}</p>; }",
            errors: [{ messageId: "message" }],
        },
    ],
});
