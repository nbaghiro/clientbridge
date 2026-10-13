import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { suppressionLines } from "./suppressions.mjs";

const FORMS = [
    "// @ts-ignore",
    "// @ts-nocheck",
    "// @ts-expect-error a reason",
    "/* @ts-ignore */",
    "const el = <div>{/* @ts-expect-error */}</div>;",
    "// eslint-disable-next-line no-console",
    "foo(); // eslint-disable-line",
    "const x = 1; /* eslint-disable-line */",
    "/* eslint-disable */",
    "/* eslint-disable no-console */",
    "/* eslint-enable */",
    "/* eslint no-console: off */",
    "/* global window */",
    "/* globals window */",
    "// prettier-ignore",
    "/* prettier-ignore */",
    "/* istanbul ignore next */",
    "/* c8 ignore start */",
    "// c8 ignore next",
    "// biome-ignore lint: reason",
    "// tslint:disable",
    "/* tslint:disable */",
];

describe("suppression comments", () => {
    for (const form of FORMS) {
        it(`rejects ${form}`, () => {
            assert.deepEqual(
                suppressionLines("a.tsx", `const a = 1;\n${form}\nconst b = 2;\n`),
                [2],
            );
        });
    }

    it("accepts ordinary comments", () => {
        const source = [
            "// eslint runs in CI",
            "// the global zone table",
            "/* a typed note */",
            'const url = "http://x/* eslint-disable */";',
            "const text = `// @ts-ignore`;",
        ].join("\n");
        assert.deepEqual(suppressionLines("a.ts", source), []);
    });
});
