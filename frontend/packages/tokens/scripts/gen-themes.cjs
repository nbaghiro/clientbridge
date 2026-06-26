// Regenerate themes.css + themes.ts from the design exploration's theme-explorer.html.
// Run: `node packages/tokens/scripts/gen-themes.cjs` from the frontend root (or anywhere).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.resolve(__dirname, "../src");
const html = fs.readFileSync(`${ROOT}/.docs/design/theme-explorer.html`, "utf8");

const NAMES = { pewter: "Pewter", slate: "Slate", calm: "Calm", fjord: "Fjord", birch: "Birch", moss: "Moss" };
const ORDER = ["pewter", "slate", "calm", "fjord", "birch", "moss"];

const re = /\.t-([a-z]+)\s*\{([^}]+)\}/g;
const raw = {};
let m;
while ((m = re.exec(html))) {
    const vars = {};
    for (const decl of m[2].split(";")) {
        const i = decl.indexOf(":");
        if (i > 0) vars[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    raw[m[1]] = vars;
}

const firstFont = (v) => (v || "").split(",")[0].replace(/['"]/g, "").trim();
const px = (v) => parseInt((v || "0").replace(/[^0-9]/g, ""), 10);
const avatar = (v) => (v && v.includes("%") ? 999 : px(v));

let css = "/* AUTO-GENERATED from .docs/design/theme-explorer.html. :root = Pewter; set [data-theme] to switch. */\n\n";
for (const key of ORDER) {
    const v = raw[key];
    if (!v) continue;
    const sel = key === "pewter" ? ':root,\n[data-theme="pewter"]' : `[data-theme="${key}"]`;
    css += `${sel} {\n`;
    for (const [k, val] of Object.entries(v)) css += `    ${k}: ${val};\n`;
    css += "}\n\n";
}
fs.writeFileSync(`${SRC}/themes.css`, css);

const themeObj = (v) => {
    const c = (k) => v[`--${k}`];
    return {
        color: {
            bg: c("bg"), surface: c("surface"), surface2: c("surface2"), head: c("head"),
            ink: c("ink"), inkSoft: c("ink-soft"), muted: c("muted"), border: c("border"),
            borderSoft: c("border-soft"), primary: c("primary"), primaryInk: c("primary-ink"),
            accent: c("accent"), accentInk: c("accent-ink"), accentStrong: c("accent-strong"),
            accentWeak: c("accent-weak"), accentLine: c("accent-line"), success: c("success"),
            okBg: c("ok-bg"), okFg: c("ok-fg"), warnBg: c("warn-bg"), warnFg: c("warn-fg"),
            danBg: c("dan-bg"), danFg: c("dan-fg"), side: c("side"), sideInk: c("side-ink"), logo: c("logo"),
        },
        font: { ui: firstFont(c("font-ui")), display: firstFont(c("font-display")), mono: firstFont(c("font-mono")) },
        radius: { base: px(c("radius")), avatar: avatar(c("avatar-radius")) },
        borderWidth: 1.5,
        shadow: c("shadow"),
    };
};

const j = (o) => JSON.stringify(o, null, 4).replace(/"([a-zA-Z0-9]+)":/g, "$1:");
let ts = "// AUTO-GENERATED from .docs/design/theme-explorer.html — do not edit by hand.\n\n";
ts += "export const THEME_KEYS = [" + ORDER.map((k) => `"${k}"`).join(", ") + "] as const;\n";
ts += "export type ThemeKey = (typeof THEME_KEYS)[number];\n\n";
ts += "export const THEME_LABELS: Record<ThemeKey, string> = " + j(NAMES) + ";\n\n";
ts += "export const themes = {\n";
for (const key of ORDER) ts += `    ${key}: ${j(themeObj(raw[key])).replace(/\n/g, "\n    ")},\n`;
ts += "} as const;\n\n";
ts += 'export type ThemeTokens = (typeof themes)["pewter"];\n';
fs.writeFileSync(`${SRC}/themes.ts`, ts);

console.log("regenerated themes:", ORDER.filter((k) => raw[k]).join(", "));
