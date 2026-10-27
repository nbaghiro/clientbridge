import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild, preview, type InlineConfig } from "vite";

import type { Size } from "./report.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND = join(HERE, "..", "..", "..");
const DIST = join(HERE, "dist");

export const PORT = Number(process.env.BENCH_PORT ?? 8795);

const config: InlineConfig = {
    root: HERE,
    configFile: false,
    logLevel: "warn",
    optimizeDeps: { exclude: ["@journeyapps/wa-sqlite", "@powersync/web"] },
    worker: { format: "es" },
    build: { outDir: DIST, emptyOutDir: true, target: "es2022" },
    preview: { port: PORT, strictPort: true },
};

export async function build(skip: boolean): Promise<string> {
    if (!skip || !existsSync(DIST)) await viteBuild(config);
    return DIST;
}

export async function serve(dist: string): Promise<{ url: string; close: () => Promise<void> }> {
    const server = await preview({ ...config, build: { ...config.build, outDir: dist } });
    return { url: `http://localhost:${PORT}/`, close: () => server.close() };
}

class Timeout extends Error {}

export function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => {
            clearTimeout(timer);
        }),
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Timeout(`hang: ${what} took over ${ms} ms`));
            }, ms);
        }),
    ]);
}

export function outputFolder(label: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return join(FRONTEND, "..", ".scratchpad", "bench", `${stamp}-${label}`);
}

export function machine(): Record<string, string | number> {
    return {
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model ?? "unknown",
        cores: os.cpus().length,
        memoryGB: Math.round(os.totalmem() / 2 ** 30),
        node: process.version,
    };
}

export function packages(): Record<string, string> {
    const names = [
        "@powersync/web",
        "@powersync/common",
        "@journeyapps/wa-sqlite",
        "@playwright/test",
        "vite",
    ];
    return Object.fromEntries(
        names.map((name) => {
            const file = join(FRONTEND, "node_modules", name, "package.json");
            const { version } = JSON.parse(readFileSync(file, "utf8")) as { version: string };
            return [name, version];
        }),
    );
}

export function wasmSizes(folder: string): Size[] {
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
        .filter((file) => file.endsWith(".wasm"))
        .sort()
        .map((file) => ({ file, bytes: statSync(join(folder, file)).size }));
}
