import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, type Results } from "./report.ts";

function found(path: string): string[] {
    if (!statSync(path).isDirectory()) return [path];
    return readdirSync(path)
        .sort()
        .flatMap((name) => found(join(path, name)))
        .filter((file) => file.endsWith("results.json"));
}

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("usage: node bench/tables.ts <results.json or folder>...");
for (const file of paths.flatMap(found)) {
    process.stdout.write(`${render(JSON.parse(readFileSync(file, "utf8")) as Results)}\n`);
}
