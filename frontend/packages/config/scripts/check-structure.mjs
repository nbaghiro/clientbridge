// Fails the gate on frontend structure drift: multi-line comments, file names and concept names.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const GENERATED = new Set([
    "packages/api-client/src/generated.ts",
    "packages/sync/src/schema.ts",
    "packages/tokens/src/themes.ts",
]);
const ENTRY_FILES = new Set(["main.tsx", "entry-server.tsx", "routes.tsx"]);

// Domain files that hold no copy of their own.
const NO_STRINGS = new Set(["ledger", "notifications", "publicResource"]);
// Pages named by their nav label rather than the concept they render.
const PAGE_CONCEPT = {
    invoices: "billing",
    inbox: "messaging",
    team: "staff",
    schedule: "bookings",
    giftCards: "entitlements",
    onboarding: "business",
};
// Screens that compose several concepts and so have no domain file or strings group of their own.
const COMPOSITE_SCREENS = new Set(["acceptInvite", "login", "onlineBooking", "setup"]);
// Shared components drawn on web only so far; every other one has a same-named mobile twin.
const WEB_ONLY_UI = new Set(["Logo"]);

const files = execFileSync("git", ["ls-files", "apps", "packages"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx|mjs|js|cjs)$/.test(f))
    .filter((f) => !GENERATED.has(f));
// The embed snippet is pasted into customers' sites, so it keeps a short usage header.
const HEADER_LINES = new Map([["apps/connect/public/embed.js", 2]]);

const problems = [];

for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    const header = HEADER_LINES.get(file) ?? 0;
    let run = 0;
    lines.forEach((line, i) => {
        if (i < header) return;
        const t = line.trim();
        if (t.startsWith("//") && !/^\/\/ (eslint-|@ts-|prettier-ignore)/.test(t)) {
            run += 1;
            if (run === 2)
                problems.push(`${file}:${String(i)}: comment block longer than one line`);
        } else {
            run = 0;
        }
        if (t.startsWith("/*") && !t.includes("*/")) {
            problems.push(`${file}:${String(i + 1)}: multi-line block comment`);
        }
    });
    const name = basename(file);
    if (
        name.endsWith(".tsx") &&
        /^[a-z]/.test(name) &&
        !ENTRY_FILES.has(name) &&
        !name.includes(".test.")
    ) {
        problems.push(`${file}: component files are named in PascalCase`);
    }
}

const lowerFirst = (s) =>
    s === s.toUpperCase() ? s.toLowerCase() : s[0].toLowerCase() + s.slice(1);
const stems = (dir, ext) =>
    files
        .filter((f) => f.startsWith(dir) && f.endsWith(ext) && !f.includes(".test."))
        .map((f) => basename(f, ext));

const stringsSrc = readFileSync(join(root, "packages/app-core/src/strings.ts"), "utf8");
const groups = new Set([...stringsSrc.matchAll(/^ {4}(\w+): \{$/gm)].map((m) => m[1]));
const domains = new Set(stems("packages/app-core/src/domain/", ".ts"));

for (const domain of domains) {
    if (!NO_STRINGS.has(domain) && !groups.has(domain)) {
        problems.push(`app-core domain "${domain}" has no strings group "${domain}"`);
    }
}

const known = new Set([...domains, ...groups]);
for (const [dir, label] of [
    ["apps/web/src/pages/", "web page"],
    ["apps/mobile/src/screens/", "mobile screen"],
]) {
    for (const screen of stems(dir, ".tsx")) {
        const concept = PAGE_CONCEPT[lowerFirst(screen)] ?? lowerFirst(screen);
        if (!known.has(concept) && !COMPOSITE_SCREENS.has(concept)) {
            problems.push(`${label} "${screen}" matches no app-core domain file or strings group`);
        }
    }
}

// App files whose own layout is the control: calendar grid, tile grids, line rows, nav chrome, debug tools.
const HAND_STYLED_OK = new Set([
    "apps/web/src/components/AppShell.tsx",
    "apps/web/src/components/DebugPanel.tsx",
    "apps/web/src/components/DocEditor.tsx",
    "apps/web/src/components/ItemImageUpload.tsx",
    "apps/web/src/pages/Schedule.tsx",
    "apps/web/src/pages/Inbox.tsx",
    "apps/web/src/pages/POS.tsx",
    "apps/mobile/src/components/DocEditor.tsx",
    "apps/mobile/src/components/TabBar.tsx",
    "apps/mobile/src/screens/Schedule.tsx",
    "apps/mobile/src/screens/POS.tsx",
    "apps/mobile/src/screens/Setup.tsx",
]);

function openingTags(src, name) {
    const found = [];
    const re = new RegExp(`<${name}[\\s>]`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
        let i = m.index + name.length + 1;
        let depth = 0;
        let quote = null;
        for (; i < src.length; i++) {
            const ch = src[i];
            if (quote !== null) {
                if (ch === quote) quote = null;
            } else if (ch === '"' || ch === "`" || (ch === "'" && depth > 0)) {
                quote = ch;
            } else if (ch === "{") {
                depth += 1;
            } else if (ch === "}") {
                depth -= 1;
            } else if (ch === ">" && depth === 0) {
                break;
            }
        }
        found.push({
            tag: src.slice(m.index, i + 1),
            line: src.slice(0, m.index).split("\n").length,
        });
    }
    return found;
}

const appFiles = files.filter(
    (f) => /^apps\/(web|connect|mobile)\/(src\/|App\.tsx$)/.test(f) && f.endsWith(".tsx"),
);
for (const file of appFiles) {
    if (HAND_STYLED_OK.has(file)) continue;
    const src = readFileSync(join(root, file), "utf8");
    for (const name of ["button", "input", "select", "textarea"]) {
        for (const { tag, line } of openingTags(src, name)) {
            if (/\bclassName=/.test(tag) && !/type="(file|color)"/.test(tag)) {
                problems.push(
                    `${file}:${String(line)}: styled <${name}>; use the @clientbridge/ui control`,
                );
            }
        }
    }
    for (const name of ["Pressable", "TextInput"]) {
        for (const { tag, line } of openingTags(src, name)) {
            if (/style=\{\[?\s*styles\./.test(tag)) {
                problems.push(
                    `${file}:${String(line)}: <${name}> with local styles; use the @clientbridge/ui control`,
                );
            }
        }
    }
}

const webUi = new Set(stems("packages/ui/src/web/", ".tsx"));
const mobileUi = new Set(stems("packages/ui/src/mobile/", ".tsx"));
for (const name of webUi) {
    if (!mobileUi.has(name) && !WEB_ONLY_UI.has(name)) {
        problems.push(
            `packages/ui/src/web/${name}.tsx has no packages/ui/src/mobile/${name}.tsx twin`,
        );
    }
}
for (const name of mobileUi) {
    if (!webUi.has(name)) {
        problems.push(
            `packages/ui/src/mobile/${name}.tsx has no packages/ui/src/web/${name}.tsx twin`,
        );
    }
}

// knip treats everything behind app-core's `export *` index as public API, so this catches what it can't.
const sources = new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")]));
const PACKAGE_ENTRIES = new Set(["index.ts", "public.ts"]);
const exported = /^export (?:async )?(?:function|const|let|class|interface|type|enum) ([\w$]+)/gm;
for (const [file, src] of sources) {
    if (!/^packages\/[^/]+\/src\//.test(file) || PACKAGE_ENTRIES.has(basename(file))) continue;
    if (file.includes(".test.")) continue;
    for (const [, name] of src.matchAll(exported)) {
        const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`);
        const usedElsewhere = [...sources].some(
            ([other, text]) => other !== file && word.test(text),
        );
        if (!usedElsewhere)
            problems.push(`${file}: ${name} is exported but only used in its own file`);
    }
}

if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\ncheck-structure: ${String(problems.length)} problem(s)`);
    process.exit(1);
}
console.log("check-structure: ok");
