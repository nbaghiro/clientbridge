import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { render, type ModeResult, type Results, type TimingRun } from "./report.ts";
import { build, machine, outputFolder, packages, serve, wasmSizes, within } from "./serve.ts";

// Real Safari through safaridriver, which needs "Allow remote automation" (or `sudo safaridriver --enable`).
const { values: args } = parseArgs({
    options: {
        vfs: { type: "string", default: "IDBBatchAtomicVFS,OPFSCoopSyncVFS,InMemoryVFS" },
        runs: { type: "string", default: "10" },
        reloads: { type: "string", default: "20" },
        "no-build": { type: "boolean", default: false },
        label: { type: "string", default: process.platform },
        out: { type: "string" },
    },
});

const DRIVER_PORT = Number(process.env.SAFARI_DRIVER_PORT ?? 8796);
const DRIVER = `http://localhost:${DRIVER_PORT}`;
const RUNS = Number(args.runs);
const RELOADS = Number(args.reloads);
const SCRIPT_TIMEOUT_MS = 240_000;
const OUT = args.out ?? outputFolder(`${args.label}-safari`);

function log(...parts: (string | number)[]): void {
    process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${parts.join(" ")}\n`);
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function webdriver<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${DRIVER}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const { value } = (await response.json()) as { value: unknown };
    if (!response.ok) {
        const failure = value as { error?: string; message?: string } | null;
        throw new Error(`${failure?.error ?? response.status}: ${failure?.message ?? ""}`);
    }
    return value as T;
}

async function driverUp(): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            await fetch(`${DRIVER}/status`);
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    throw new Error("safaridriver did not start");
}

class Session {
    readonly id: string;
    readonly url: string;

    constructor(id: string, url: string) {
        this.id = id;
        this.url = url;
    }

    async load(): Promise<void> {
        await webdriver("POST", `/session/${this.id}/url`, { url: this.url });
        for (let attempt = 0; attempt < 300; attempt++) {
            const ready = await webdriver<boolean>("POST", `/session/${this.id}/execute/sync`, {
                script: "return window.benchReady === true",
                args: [],
            });
            if (ready) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("the bench page did not load");
    }

    async run<T>(call: string, values: unknown[] = []): Promise<T> {
        const script = `const done = arguments[arguments.length - 1]; (async () => window.bench.${call})().then((ok) => done({ ok }), (e) => done({ error: String((e && (e.stack || e.message)) || e) }));`;
        const outcome = await within(
            SCRIPT_TIMEOUT_MS + 5_000,
            webdriver<{ ok?: T; error?: string }>("POST", `/session/${this.id}/execute/async`, {
                script,
                args: values,
            }),
            call,
        );
        if (outcome.error !== undefined) throw new Error(outcome.error);
        return outcome.ok as T;
    }
}

const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}.db`;

async function timingRun(session: Session, vfs: string, run: number): Promise<TimingRun> {
    const result: TimingRun = { run };
    const name = unique("safari");
    try {
        await session.load();
        await session.run("wipe()");
        result.probe = await session.run("probe()");
        const opened = await session.run<{ ms: number; multiTabs: boolean }>(
            "open(arguments[0], arguments[1])",
            [vfs, name],
        );
        result.coldOpen = opened.ms;
        result.multiTabs = opened.multiTabs;
        result.checkpoint = (await session.run<{ ms: number }>("populate()")).ms;
        const reads: { listMs: number; ledgerMs: number }[] = [];
        for (let k = 0; k < 5; k++) reads.push(await session.run("read()"));
        result.readFirst = reads[0]?.listMs;
        result.read = reads
            .slice(1)
            .map((r) => r.listMs)
            .sort((a, b) => a - b)[2];
        result.ledgerRead = reads
            .slice(1)
            .map((r) => r.ledgerMs)
            .sort((a, b) => a - b)[2];
        result.sqliteBytes = (await session.run<{ bytes: number }>("sqliteSize()")).bytes;
        await session.load();
        result.reopen = (
            await session.run<{ ms: number }>("open(arguments[0], arguments[1])", [vfs, name])
        ).ms;
        result.rowsAfterReload = await session.run<number>("total()");
        await session.run("close()");
    } catch (error) {
        result.error = message(error);
    }
    return result;
}

async function main(): Promise<void> {
    const dist = await build(args["no-build"]);
    const server = await serve(dist);
    const driver = spawn("safaridriver", ["-p", String(DRIVER_PORT)], { stdio: "inherit" });
    mkdirSync(OUT, { recursive: true });
    let id: string | null = null;
    const results: Results = {
        stamp: new Date().toISOString(),
        label: args.label,
        machine: machine(),
        browser: { name: "safari", channel: null, version: "", headed: true },
        packages: packages(),
        dataset: { business: "", rows: 0 },
        env: {},
        wasm: { web: null, bench: wasmSizes(join(dist, "assets")) },
        vfs: {},
    };
    const save = () => {
        writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
        writeFileSync(join(OUT, "tables.md"), render(results));
    };
    try {
        await driverUp();
        const created = await webdriver<{
            sessionId: string;
            capabilities: { browserVersion?: string };
        }>("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
        id = created.sessionId;
        results.browser.version = created.capabilities.browserVersion ?? "";
        await webdriver("POST", `/session/${id}/timeouts`, { script: SCRIPT_TIMEOUT_MS });
        const session = new Session(id, server.url);
        await session.load();
        results.env = await session.run("env()");
        results.dataset = await session.run("dataset()");
        log("safari", results.browser.version);
        for (const vfs of args.vfs.split(",")) {
            const mr: ModeResult = { timing: [], tabs: [] };
            results.vfs[vfs] = { modes: { safaridriver: mr } };
            for (let run = 0; run < RUNS; run++) {
                const r = await timingRun(session, vfs, run);
                mr.timing.push(r);
                log(
                    vfs,
                    `run ${run}`,
                    r.error?.split("\n")[0] ??
                        `open ${r.coldOpen?.toFixed(0) ?? "?"} checkpoint ${r.checkpoint?.toFixed(0) ?? "?"} reopen ${r.reopen?.toFixed(0) ?? "?"}`,
                );
                if (run === 0 && r.coldOpen === undefined) break;
            }
            if (mr.timing.some((r) => r.coldOpen !== undefined)) {
                const loop: { opens: number[]; wrongRows: number; error?: string } = {
                    opens: [],
                    wrongRows: 0,
                };
                mr.reloads = loop;
                const name = unique("reloads");
                try {
                    await session.load();
                    await session.run("open(arguments[0], arguments[1])", [vfs, name]);
                    await session.run("populate()");
                    for (let k = 0; k < RELOADS; k++) {
                        await session.load();
                        const opened = await session.run<{ ms: number }>(
                            "open(arguments[0], arguments[1])",
                            [vfs, name],
                        );
                        loop.opens.push(opened.ms);
                        if ((await session.run<number>("total()")) !== results.dataset.rows)
                            loop.wrongRows++;
                    }
                    await session.run("close()");
                } catch (error) {
                    loop.error = message(error);
                }
                log(
                    vfs,
                    "reloads",
                    loop.error?.split("\n")[0] ?? loop.opens.map((o) => o.toFixed(0)).join(","),
                );
            }
            save();
        }
        await session.load();
        await session.run("wipe()");
    } finally {
        save();
        if (id) await webdriver("DELETE", `/session/${id}`).catch(() => undefined);
        driver.kill();
        await server.close();
        log(`results in ${OUT}`);
    }
}

await main();
