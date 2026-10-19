// Checks the catalogs (ICU syntax, arguments, unused keys) and writes the strings accessors, en-XA and embed.js.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import ts from "typescript";

const frontend = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CATALOGS = [
    { dir: "packages/app-core", runtime: "./locale" },
    { dir: "apps/site", runtime: "@clientbridge/app-core/public" },
];

const problems = [];

function argTypes(elements, types = new Map()) {
    const set = (name, type) => {
        const had = types.get(name);
        if (had === undefined || had === "string") types.set(name, type);
        else if (had !== type && type !== "string") problems.push(`${name} is ${had} and ${type}`);
    };
    for (const el of elements) {
        if (el.type === TYPE.argument) set(el.value, "string");
        else if (el.type === TYPE.number) set(el.value, "number");
        else if (el.type === TYPE.plural) set(el.value, "number");
        else if (el.type === TYPE.select) {
            const keys = Object.keys(el.options);
            set(
                el.value,
                keys.every((k) => ["true", "false", "other"].includes(k)) ? "boolean" : "string",
            );
        } else if (el.type === TYPE.date || el.type === TYPE.time) {
            problems.push(`${el.value}: format dates before passing them in`);
        }
        if (el.options) for (const o of Object.values(el.options)) argTypes(o.value, types);
    }
    return types;
}

function typeTree(dir, source) {
    const tree = new Map();
    for (const [key, entry] of Object.entries(source)) {
        let ast;
        try {
            ast = parse(entry.message, { ignoreTag: true });
        } catch (e) {
            problems.push(`${dir} ${key}: ${e.message}`);
            continue;
        }
        const types = argTypes(ast);
        const args = entry.args ?? [];
        const used = [...types.keys()];
        if (args.length !== used.length || used.some((a) => !args.includes(a))) {
            problems.push(
                `${dir} ${key}: args [${args.join(", ")}] but the message uses [${used.join(", ")}]`,
            );
        }
        const path = key.split(".");
        const name = path.pop();
        let node = tree;
        for (const segment of path) {
            if (!node.has(segment)) node.set(segment, new Map());
            node = node.get(segment);
        }
        node.set(
            name,
            entry.args === undefined
                ? "string"
                : `(${args.map((a) => `${a}: ${types.get(a) ?? "string"}`).join(", ")}) => string`,
        );
    }
    return tree;
}

const isList = (node) => [...node.keys()].every((k, i) => k === String(i));
const prop = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

function typeOf(node) {
    if (typeof node === "string") return node;
    if (isList(node)) {
        return `readonly [${[...node.values()].map(typeOf).join(", ")}]`;
    }
    const body = [...node].map(([k, v]) => `readonly ${prop(k)}: ${typeOf(v)};`).join(" ");
    const children = [...node.values()];
    if (children.every((v) => v === "string")) return `{ ${body} } & Labels`;
    if (children.every((v) => v instanceof Map && isList(v))) {
        return `{ ${body} } & Readonly<Record<string, readonly string[]>>`;
    }
    return `{ ${body} }`;
}

const ACCENTS = Object.fromEntries(
    [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) => [
        c,
        [..."åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇĐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ"][i],
    ]),
);
const PADDING = "one two three four five six seven eight nine ten".split(" ");

function accent(elements) {
    let letters = 0;
    for (const el of elements) {
        if (el.type === TYPE.literal) {
            letters += (el.value.match(/[A-Za-z]/g) ?? []).length;
            el.value = el.value.replace(/[A-Za-z]/g, (c) => ACCENTS[c]);
        }
        if (el.options) for (const o of Object.values(el.options)) letters += accent(o.value);
    }
    return letters;
}

function pseudoOf(source) {
    const pseudo = {};
    for (const [key, entry] of Object.entries(source)) {
        if (entry.message === "") {
            pseudo[key] = { message: "" };
            continue;
        }
        const ast = parse(entry.message, { ignoreTag: true });
        const letters = accent(ast);
        if (letters === 0) {
            pseudo[key] = { message: entry.message };
            continue;
        }
        const pad = [];
        while (pad.join(" ").length < Math.ceil(letters * 0.35)) pad.push(PADDING[pad.length % 10]);
        pseudo[key] = { message: `[${printAST(ast)}${pad.length > 0 ? ` ${pad.join(" ")}` : ""}]` };
    }
    return pseudo;
}

const sources = new Map();
for (const { dir, runtime } of CATALOGS) {
    const source = JSON.parse(readFileSync(join(frontend, dir, "locales/en-CA.json"), "utf8"));
    sources.set(dir, source);
    const tree = typeTree(dir, source);
    if (problems.length > 0) continue;
    writeFileSync(
        join(frontend, dir, "src/strings.ts"),
        `// Generated from locales/en-CA.json by \`make gen-strings\`; edit the catalog, not this file.
import english from "../locales/en-CA.json" with { type: "json" };
import { catalog } from "${runtime}";

type Labels = Readonly<Record<string, string>>;

interface Strings ${typeOf(tree)}

export const strings = catalog(
    english,
    async () => (await import("../locales/en-XA.json")).default,
) as Strings;
`,
    );
    writeFileSync(
        join(frontend, dir, "locales/en-XA.json"),
        `${JSON.stringify(pseudoOf(source), null, 4)}\n`,
    );
}

function plainText(key, entry) {
    const ast = parse(entry.message, { ignoreTag: true });
    if (ast.some((el) => el.type !== TYPE.literal))
        problems.push(`${key}: the embed takes plain text`);
    return ast.map((el) => el.value).join("");
}

const embedText = {};
for (const [key, entry] of Object.entries(sources.get("packages/app-core"))) {
    if (!key.startsWith("embed.")) continue;
    const path = key.split(".").slice(1);
    const name = path.pop();
    let node = embedText;
    for (const segment of path) node = node[segment] ??= {};
    node[name] = plainText(key, entry);
}

// The embed keys are read by this script, not by an app.
const READ_HERE = ["embed."];

function sourceFiles() {
    return execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages"],
        {
            cwd: frontend,
            encoding: "utf8",
        },
    )
        .split("\n")
        .filter(
            (f) =>
                // an app's root entry (mobile App.tsx) renders copy too; *.config.ts never does
                (/\/src\/.*\.tsx?$/.test(f) || /^apps\/[^/]+\/[^/.]+\.tsx?$/.test(f)) &&
                !/\.test\.tsx?$/.test(f) &&
                !f.endsWith("/strings.ts"),
        )
        .map((f) => join(frontend, f))
        .filter((f) => existsSync(f));
}

function usedKeys() {
    const accessor = new Set(CATALOGS.map(({ dir }) => join(frontend, dir, "src/strings.ts")));
    const program = ts.createProgram([...sourceFiles(), ...accessor], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
        noEmit: true,
    });
    const checker = program.getTypeChecker();
    const used = new Map(CATALOGS.map(({ dir }) => [dir, new Set()]));
    const pathOf = (decl) => {
        const names = [];
        for (let n = decl; n; n = n.parent) {
            if (ts.isPropertySignature(n)) names.unshift(n.name.getText().replace(/^"|"$/g, ""));
        }
        const dir = CATALOGS.find(
            (c) => decl.getSourceFile().fileName === join(frontend, c.dir, "src/strings.ts"),
        )?.dir;
        return dir === undefined ? null : { dir, key: names.join(".") };
    };
    const mark = (decl, subtree) => {
        const at = pathOf(decl);
        if (at !== null) used.get(at.dir).add(subtree ? `${at.key}.` : at.key);
    };
    const catalogDecl = (node) =>
        (checker.getSymbolAtLocation(node)?.declarations ?? []).find((d) =>
            accessor.has(d.getSourceFile().fileName),
        );
    const aliases = new Map();
    const escapes = [];
    const readsCatalog = (node) =>
        (ts.isPropertyAccessExpression(node) && catalogDecl(node.name) !== undefined) ||
        (ts.isElementAccessExpression(node) && catalogDecl(node.expression) !== undefined);
    const visit = (node) => {
        const target = ts.isPropertyAccessExpression(node)
            ? node.name
            : ts.isElementAccessExpression(node)
              ? node.expression
              : null;
        const decl = target === null ? undefined : catalogDecl(target);
        if (decl !== undefined) {
            const parent = node.parent;
            const chained =
                (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
                parent.expression === node &&
                readsCatalog(parent);
            const aliased =
                ts.isVariableDeclaration(parent) &&
                parent.initializer === node &&
                parent.type === undefined;
            if (aliased) aliases.set(checker.getSymbolAtLocation(parent.name), decl);
            mark(decl, ts.isElementAccessExpression(node) || (!chained && !aliased));
        } else if (ts.isIdentifier(node) && !ts.isVariableDeclaration(node.parent)) {
            const parent = node.parent;
            const chained =
                (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
                parent.expression === node &&
                readsCatalog(parent);
            if (!chained) escapes.push(checker.getSymbolAtLocation(node));
        }
        ts.forEachChild(node, visit);
    };
    for (const file of program.getSourceFiles()) {
        if (!file.isDeclarationFile && !accessor.has(file.fileName)) visit(file);
    }
    for (const found of escapes) {
        const symbol =
            found !== undefined && found.flags & ts.SymbolFlags.Alias
                ? checker.getAliasedSymbol(found)
                : found;
        const decl = symbol === undefined ? undefined : aliases.get(symbol);
        if (decl !== undefined) mark(decl, true);
    }
    return used;
}

if (problems.length === 0) {
    const used = usedKeys();
    for (const { dir } of CATALOGS) {
        const marks = used.get(dir);
        const prefixes = [...marks].filter((m) => m.endsWith("."));
        for (const key of Object.keys(sources.get(dir))) {
            const isUsed =
                marks.has(key) ||
                prefixes.some((p) => key.startsWith(p) || `${key}.` === p) ||
                READ_HERE.some((p) => key.startsWith(p));
            if (!isUsed) problems.push(`${dir} ${key}: not used by any app`);
        }
    }
}

if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(1);
}

const loader = ts
    .transpileModule(readFileSync(join(frontend, "apps/connect/src/embedLoader.ts"), "utf8"), {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            removeComments: true,
        },
    })
    .outputText.replace(/^export \{\};\n/m, "")
    .replace(/^export /gm, "");
writeFileSync(
    join(frontend, "apps/connect/public/embed.js"),
    `// Generated from src/embedLoader.ts by \`make gen-strings\`. Use: <script src=".../embed.js" async></script>
// then <connect-booking slug="…"> or <connect-pay|form|contract token="…">; each fires connect:success.
(function () {
"use strict";
${loader}
loadEmbeds(${JSON.stringify(embedText)});
})();
`,
);
