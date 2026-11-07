const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../src");
const css = fs.readFileSync(`${SRC}/themes.css`, "utf8");

const NAMES = {
    pewter: "Pewter",
    slate: "Slate",
    calm: "Calm",
    fjord: "Fjord",
    birch: "Birch",
    moss: "Moss",
};
const ORDER = ["pewter", "slate", "calm", "fjord", "birch", "moss"];

const re = /\[data-theme="([a-z]+)"\]\s*\{([^}]+)\}/g;
const raw = {};
let m;
while ((m = re.exec(css))) {
    const vars = {};
    for (const decl of m[2].split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const value = decl.slice(i + 1).trim();
        vars[decl.slice(0, i).trim()] = /^#[0-9a-f]+$/i.test(value) ? value.toUpperCase() : value;
    }
    raw[m[1]] = vars;
}

const firstFont = (v) => (v || "").split(",")[0].replace(/['"]/g, "").trim();
const px = (v) => parseInt((v || "0").replace(/[^0-9]/g, ""), 10);
const avatar = (v) => (v && v.includes("%") ? 999 : px(v));

const themeObj = (v) => {
    const c = (k) => v[`--${k}`];
    return {
        color: {
            bg: c("bg"),
            surface: c("surface"),
            surface2: c("surface2"),
            head: c("head"),
            ink: c("ink"),
            inkSoft: c("ink-soft"),
            muted: c("muted"),
            border: c("border"),
            borderSoft: c("border-soft"),
            primary: c("primary"),
            primaryInk: c("primary-ink"),
            accent: c("accent"),
            accentInk: c("accent-ink"),
            accentStrong: c("accent-strong"),
            accentWeak: c("accent-weak"),
            accentLine: c("accent-line"),
            success: c("success"),
            okBg: c("ok-bg"),
            okFg: c("ok-fg"),
            warnBg: c("warn-bg"),
            warnFg: c("warn-fg"),
            danBg: c("dan-bg"),
            danFg: c("dan-fg"),
            side: c("side"),
            sideInk: c("side-ink"),
            logo: c("logo"),
        },
        font: {
            ui: firstFont(c("font-ui")),
            display: firstFont(c("font-display")),
            mono: firstFont(c("font-mono")),
        },
        radius: { base: px(c("radius")), avatar: avatar(c("avatar-radius")) },
        borderWidth: 1.5,
        shadow: c("shadow"),
    };
};

const j = (o) => JSON.stringify(o, null, 4).replace(/"([a-zA-Z0-9]+)":/g, "$1:");
let ts = "// AUTO-GENERATED from themes.css by `make gen-themes`; edit the CSS, not this file.\n\n";
ts += "export const THEME_KEYS = [" + ORDER.map((k) => `"${k}"`).join(", ") + "] as const;\n";
ts += "export type ThemeKey = (typeof THEME_KEYS)[number];\n\n";
ts += "export const THEME_LABELS: Record<ThemeKey, string> = " + j(NAMES) + ";\n\n";
ts += "export const themes = {\n";
for (const key of ORDER) ts += `    ${key}: ${j(themeObj(raw[key])).replace(/\n/g, "\n    ")},\n`;
ts += "} as const;\n\n";
ts += 'export type ThemeTokens = (typeof themes)["pewter"];\n';
fs.writeFileSync(`${SRC}/themes.ts`, ts);

process.stdout.write(`regenerated themes: ${ORDER.filter((k) => raw[k]).join(", ")}\n`);
