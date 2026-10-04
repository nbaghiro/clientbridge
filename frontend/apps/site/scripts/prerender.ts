// Turns the client build (dist/index.html + CSS) and the SSR build (dist-server) into one static HTML
// file per route. The pages need no JavaScript, so the dev-only client script is dropped.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RenderedPage } from "../src/entry-server.tsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const server = join(root, "dist-server");

const template = readFileSync(join(dist, "index.html"), "utf8")
    .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");

const entry = (await import(pathToFileURL(join(server, "entry-server.js")).href)) as {
    renderAll: () => RenderedPage[];
};

for (const page of entry.renderAll()) {
    const html = template
        .replace("<!--app-head-->", page.head)
        .replace("<!--app-html-->", page.html);
    const out = join(dist, page.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    process.stdout.write(`prerendered ${page.file}\n`);
}

for (const file of readdirSync(join(dist, "assets"))) {
    if (file.endsWith(".js")) rmSync(join(dist, "assets", file));
}
rmSync(server, { recursive: true, force: true });
