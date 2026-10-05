// Holds src/content and the built pages to the house style: no em-dashes, hype words or "coming soon".
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RULES: { name: string; pattern: RegExp }[] = [
    { name: "em-dash", pattern: /\u2014/ },
    {
        name: "hype word",
        pattern:
            /\b(seamless(ly)?|leverag(e|es|ed|ing)|robust|delv(e|es|ing)|supercharg(e|es|ed|ing)|effortless(ly)?|game-changer|revolutioni[sz](e|es|ed|ing)|cutting-edge)\b/i,
    },
    {
        name: "unfinished-product wording",
        pattern: /\b(beta|coming soon|early access|waitlist)\b/i,
    },
    { name: "exclamation mark", pattern: /!/ },
];

const walk = (dir: string, ext: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path, ext) : path.endsWith(ext) ? [path] : [];
    });

/** The copy in a content module: its quoted and template string literals. */
const literals = (source: string): string[] =>
    [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(
        (m) => m[1] ?? m[2] ?? "",
    );

/** The text a reader sees on a built page: tags, scripts and styles removed, entities decoded. */
const visibleText = (html: string): string =>
    html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<!doctype[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

const problems: string[] = [];
const check = (where: string, text: string): void => {
    for (const rule of RULES) {
        const hit = rule.pattern.exec(text);
        if (hit)
            problems.push(`${where}: ${rule.name} "${hit[0]}" in "${text.trim().slice(0, 80)}"`);
    }
};

for (const file of walk(join(root, "src", "content"), ".ts")) {
    for (const text of literals(readFileSync(file, "utf8"))) check(relative(root, file), text);
}

const dist = join(root, "dist");
if (existsSync(dist)) {
    for (const file of walk(dist, ".html")) {
        for (const line of visibleText(readFileSync(file, "utf8")).split(/\s{2,}/)) {
            if (line.trim()) check(relative(root, file), line);
        }
    }
} else {
    process.stdout.write("content-lint: no dist yet, checked src/content only\n");
}

if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n${String(problems.length)} copy problem(s)\n`);
    process.exit(1);
}
process.stdout.write("content-lint: copy is clean\n");
