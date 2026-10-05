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
const NO_STRINGS = new Set([
    "packages",
    "subscriptions",
    "ledger",
    "notifications",
    "publicResource",
]);
// Pages named by their nav label rather than the concept they render.
const PAGE_CONCEPT = { invoices: "billing", inbox: "messaging", team: "staff" };
// Screens that compose several concepts and so have no domain file or strings group of their own.
const COMPOSITE_SCREENS = new Set(["acceptInvite", "login", "onlineBooking", "setup"]);
// Shared components drawn on web only so far; every other one has a same-named mobile twin.
const WEB_ONLY_UI = new Set(["Logo", "Panel"]);

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

if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\ncheck-structure: ${String(problems.length)} problem(s)`);
    process.exit(1);
}
console.log("check-structure: ok");
