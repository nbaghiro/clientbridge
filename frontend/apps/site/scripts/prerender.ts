// Turns the client build (dist/index.html + CSS) and the SSR build (dist-server) into one static HTML
// file per route. The pages need no JavaScript, so the dev-only client script is dropped.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RenderedPage } from "../src/entry-server.tsx";
import { type LogoGeometry, writeOgImages } from "./og.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const server = join(root, "dist-server");

const template = readFileSync(join(dist, "index.html"), "utf8")
    .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");

const entry = (await import(pathToFileURL(join(server, "entry-server.js")).href)) as {
    renderAll: () => RenderedPage[];
    siteUrl: string;
    logo: LogoGeometry;
};

const pages = entry.renderAll();
for (const page of pages) {
    const html = template
        .replace("<!--app-head-->", page.head)
        .replace("<!--app-html-->", page.html);
    const out = join(dist, page.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    process.stdout.write(`prerendered ${page.file}\n`);
}

const today = new Date().toISOString().slice(0, 10);
const urls = pages
    .filter((p) => p.indexable)
    .map(
        (p) =>
            `  <url><loc>${entry.siteUrl}${p.path === "/" ? "/" : p.path}</loc><lastmod>${today}</lastmod></url>`,
    );
writeFileSync(
    join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
);
writeFileSync(
    join(dist, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${entry.siteUrl}/sitemap.xml\n`,
);
await writeOgImages(pages, dist, join(root, "public", "art", "small.svg"), entry.logo);
process.stdout.write(
    `wrote sitemap.xml, robots.txt and ${String(new Set(pages.map((p) => p.ogImage)).size)} share images\n`,
);

for (const file of readdirSync(join(dist, "assets"))) {
    if (file.endsWith(".js")) rmSync(join(dist, "assets", file));
}
rmSync(server, { recursive: true, force: true });
