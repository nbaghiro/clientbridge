// Draws the contour fields to public/art/*.svg (deterministic, regenerated before dev and build).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FIELDS, fieldSvg, type FieldName } from "../src/art/geometry.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
mkdirSync(out, { recursive: true });
for (const name of Object.keys(FIELDS) as FieldName[]) {
    writeFileSync(join(out, `${name}.svg`), fieldSvg(name));
}
