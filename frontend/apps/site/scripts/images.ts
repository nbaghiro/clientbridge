// Writes each stock photo in assets/photos/ as AVIF, WebP and JPEG at the widths the <Photo>
// component asks for. Outputs go to public/photos/ (git-ignored) and are skipped when already current.
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp, { type Sharp } from "sharp";

import { PHOTO_WIDTHS } from "../src/content/photos.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets", "photos");
const out = join(root, "public", "photos");
mkdirSync(out, { recursive: true });

const FORMATS = {
    avif: (s: Sharp) => s.avif({ quality: 52, effort: 4 }),
    webp: (s: Sharp) => s.webp({ quality: 72 }),
    jpg: (s: Sharp) => s.jpeg({ quality: 76, mozjpeg: true, progressive: true }),
} as const;

const fresh = (target: string, sourceTime: number): boolean => {
    try {
        return statSync(target).mtimeMs >= sourceTime;
    } catch {
        return false;
    }
};

let written = 0;
for (const file of readdirSync(src).filter((f) => f.endsWith(".jpg"))) {
    const name = basename(file, ".jpg");
    const input = join(src, file);
    const sourceTime = statSync(input).mtimeMs;
    for (const width of PHOTO_WIDTHS) {
        for (const [ext, encode] of Object.entries(FORMATS)) {
            const target = join(out, `${name}-${String(width)}.${ext}`);
            if (fresh(target, sourceTime)) continue;
            await encode(sharp(input).resize({ width, withoutEnlargement: true })).toFile(target);
            written += 1;
        }
    }
}
process.stdout.write(`images: ${String(written)} written\n`);
