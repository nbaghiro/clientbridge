import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./no-composed-copy.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
}).run("no-composed-copy", rule, {
    valid: [
        "const sql = `SELECT id FROM clients WHERE business_id = ? ${order}`;",
        "const q = `${utcSql(column)} >= datetime(?)`;",
        "const url = `${base}/v1/clients/${id}`;",
        "const key = `invoice:${id}`;",
        "const file = `${name}-booking-qr.svg`;",
        "const a = <div className={`${GRID} ${active ? '' : 'opacity-60'}`} />;",
        "const cls = () => `rounded-md border px-3 py-2 ${tone}`;",
        "const a = <div style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} />;",
        "const c = `color-mix(in srgb, ${primary} 82%, black)`;",
        'const head = `<meta name="description" content="${text}" />`;',
        "const ics = `SUMMARY:${title}`;",
        "throw new Error(`missing ${name}`);",
        "const a = <p>{`${label}`}</p>;",
        "const lines = [summary, list].join('\\n\\n');",
        "const srcSet = (n) => sizes.map((w) => `${url(n, w)} ${w}w`).join(', ');",
        "const name = parts.join(' ');",
        "const t = sql`SELECT ${x} FROM y`;",
    ],
    invalid: [
        { code: "const a = <p>{`${count} items`}</p>;", errors: [{ messageId: "composed" }] },
        {
            code: "const o = { label: `${s.dueNow} ${deposit}` };",
            errors: [{ messageId: "composed" }],
        },
        {
            code: "const a = <Field label={`${label} (${unit})`} />;",
            errors: [{ messageId: "composed" }],
        },
        { code: "const o = { label: `$${amount}` };", errors: [{ messageId: "composed" }] },
        { code: "const a = <p>{`• ${line}`}</p>;", errors: [{ messageId: "composed" }] },
        { code: "const detail = `${strip}. ${lastSynced}`;", errors: [{ messageId: "composed" }] },
        { code: "const text = title + ' · ' + time;", errors: [{ messageId: "composed" }] },
        { code: "const names = people.join(', ');", errors: [{ messageId: "join" }] },
        {
            code: "const a = <p>{cart}{n ? ` (${n})` : ''}</p>;",
            errors: [{ messageId: "composed" }],
        },
    ],
});
