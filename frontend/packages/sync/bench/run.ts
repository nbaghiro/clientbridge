import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
    chromium,
    firefox,
    webkit,
    type Browser,
    type BrowserContext,
    type BrowserType,
    type Page,
} from "@playwright/test";

import {
    render,
    type CrashRun,
    type ModeResult,
    type Relaunch,
    type ReloadLoop,
    type Results,
    type TabsRun,
    type TimingRun,
    type VfsResult,
} from "./report.ts";
import { build, machine, outputFolder, packages, serve, wasmSizes, within } from "./serve.ts";

const { values: args } = parseArgs({
    options: {
        browser: { type: "string", default: "chromium" },
        vfs: { type: "string", default: "IDBBatchAtomicVFS,OPFSCoopSyncVFS,InMemoryVFS" },
        modes: { type: "string", default: "private,profile" },
        runs: { type: "string", default: "10" },
        "tab-runs": { type: "string", default: "20" },
        reloads: { type: "string", default: "20" },
        "crash-runs": { type: "string", default: "0" },
        "crash-vfs": { type: "string", default: "OPFSCoopSyncVFS,IDBBatchAtomicVFS" },
        "skip-behaviour": { type: "boolean", default: false },
        headed: { type: "boolean", default: false },
        "no-build": { type: "boolean", default: false },
        "web-dist": { type: "string" },
        label: { type: "string", default: process.platform },
        out: { type: "string" },
    },
});

const ENGINES: Record<string, { type: BrowserType; channel: string | null }> = {
    chromium: { type: chromium, channel: null },
    firefox: { type: firefox, channel: null },
    webkit: { type: webkit, channel: null },
    chrome: { type: chromium, channel: "chrome" },
    msedge: { type: chromium, channel: "msedge" },
};
const chosen = ENGINES[args.browser];
if (!chosen) throw new Error(`unknown browser ${args.browser}`);
const engine = chosen;
const launchOptions = {
    headless: !args.headed,
    ...(engine.channel ? { channel: engine.channel } : {}),
};
const VFS_LIST = args.vfs.split(",");
const MODES = args.modes.split(",");
const RUNS = Number(args.runs);
const TAB_RUNS = Number(args["tab-runs"]);
const RELOADS = Number(args.reloads);
const CRASH_RUNS = Number(args["crash-runs"]);
const CRASH_VFS = args["crash-vfs"].split(",");
const TAB_WRITES = 200;
const T = {
    open: 30_000,
    populate: 240_000,
    read: 30_000,
    write: 60_000,
    misc: 30_000,
    close: 15_000,
};

const OUT = args.out ?? outputFolder(`${args.label}-${args.browser}`);
const LOGS = join(OUT, "logs");
mkdirSync(LOGS, { recursive: true });

function log(...parts: (string | number)[]): void {
    process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${parts.join(" ")}\n`);
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function attachLogs(
    page: Page,
    file: string,
): { write: (line: string) => void; crashed: () => boolean } {
    let crashed = false;
    const write = (line: string) => {
        appendFileSync(join(LOGS, file), `${new Date().toISOString()} ${line}\n`);
    };
    page.on("console", (m) => {
        write(`[console.${m.type()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => {
        write(`[pageerror] ${e.message}`);
    });
    page.on("crash", () => {
        crashed = true;
        write("[crash]");
    });
    return { write, crashed: () => crashed };
}

let url = "";
let rows = 0;

async function ready(page: Page): Promise<void> {
    await page.waitForFunction(() => window.benchReady, null, { timeout: T.misc });
}

async function load(page: Page, path = "/"): Promise<void> {
    await page.goto(new URL(path, url).href);
    await ready(page);
}

async function reload(page: Page): Promise<void> {
    await page.reload();
    await ready(page);
}

const open = (page: Page, vfs: string, name: string) =>
    within(
        T.open,
        page.evaluate(([v, n]) => window.bench.open(v, n), [vfs, name] as const),
        "open",
    );
const populate = (page: Page) =>
    within(
        T.populate,
        page.evaluate(() => window.bench.populate()),
        "populate",
    );
const read = (page: Page) =>
    within(
        T.read,
        page.evaluate(() => window.bench.read()),
        "read",
    );
const total = (page: Page) =>
    within(
        T.read,
        page.evaluate(() => window.bench.total()),
        "count",
    );
const storage = (page: Page) =>
    within(
        T.misc,
        page.evaluate(() => window.bench.storage()),
        "storage",
    );
const closeDatabase = (page: Page) =>
    within(
        T.close,
        page.evaluate(() => window.bench.close()),
        "close",
    );
const probe = (page: Page) =>
    within(
        T.misc,
        page.evaluate(() => window.bench.probe()),
        "probe",
    );

async function quietly(what: string, action: () => Promise<unknown>): Promise<string | null> {
    try {
        await within(T.close, action(), what);
        return null;
    } catch (error) {
        return message(error);
    }
}

const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}.db`;

interface Context {
    context: BrowserContext;
    profile: string | null;
}

// Playwright's macOS WebKit keeps OPFS outside the profile folder, so every context wipes its origin.
async function wipe(context: BrowserContext, file: string): Promise<void> {
    try {
        const page = await context.newPage();
        await load(page);
        const errors = await within(
            T.misc,
            page.evaluate(() => window.bench.wipe()),
            "wipe",
        );
        if (errors.length) appendFileSync(join(LOGS, file), `wipe errors: ${errors.join("; ")}\n`);
        await page.close();
    } catch (error) {
        appendFileSync(join(LOGS, file), `wipe failed: ${message(error)}\n`);
    }
}

async function launchProfile(profile: string): Promise<BrowserContext> {
    return engine.type.launchPersistentContext(profile, launchOptions);
}

async function makeContext(mode: string, browser: Browser, tag: string): Promise<Context> {
    if (mode === "private") return { context: await browser.newContext(), profile: null };
    const profile = mkdtempSync(join(tmpdir(), `bench-${tag}-`));
    const context = await launchProfile(profile);
    await wipe(context, `${tag}-wipe.log`);
    return { context, profile };
}

async function dropContext({ context, profile }: Context): Promise<void> {
    if (profile) {
        for (const page of context.pages()) await quietly("page close", () => page.close());
        await wipe(context, "wipe.log");
    }
    await quietly("context close", () => context.close());
    if (profile) rmSync(profile, { recursive: true, force: true });
}

async function firstPage(context: BrowserContext): Promise<Page> {
    return context.pages()[0] ?? (await context.newPage());
}

async function timingRun(
    mode: string,
    browser: Browser,
    vfs: string,
    run: number,
): Promise<TimingRun> {
    const result: TimingRun = { run };
    const context = await makeContext(mode, browser, `${vfs}-timing`);
    const page = await firstPage(context.context);
    const logs = attachLogs(page, `${vfs}-${mode}-timing-${run}.log`);
    const name = unique("timing");
    try {
        await load(page);
        result.probe = await probe(page);
        const baseline = (await storage(page)).estimate.usage ?? 0;
        const opened = await open(page, vfs, name);
        result.coldOpen = opened.ms;
        result.multiTabs = opened.multiTabs;
        result.checkpoint = (await populate(page)).ms;
        const reads = [];
        for (let k = 0; k < 5; k++) reads.push(await read(page));
        result.readFirst = reads[0]?.listMs;
        result.read = median(reads.slice(1).map((r) => r.listMs));
        result.ledgerRead = median(reads.slice(1).map((r) => r.ledgerMs));
        const after = await storage(page);
        result.sqliteBytes = after.sqlite?.bytes;
        result.usageBytes = (after.estimate.usage ?? 0) - baseline;
        await reload(page);
        result.reopen = (await open(page, vfs, name)).ms;
        result.rowsAfterReload = await total(page);
        await closeDatabase(page);
    } catch (error) {
        result.error = message(error);
        logs.write(`[bench] ${result.error}`);
    }
    result.crashed = logs.crashed();
    await dropContext(context);
    return result;
}

async function twoTabs(mode: string, browser: Browser, vfs: string, run: number): Promise<TabsRun> {
    const result: TabsRun = { run, passed: false };
    const context = await makeContext(mode, browser, `${vfs}-tabs`);
    const a = await firstPage(context.context);
    const b = await context.context.newPage();
    const logs = attachLogs(a, `${vfs}-${mode}-tabs-${run}-a.log`);
    attachLogs(b, `${vfs}-${mode}-tabs-${run}-b.log`);
    const name = unique("tabs");
    try {
        await load(a);
        await load(b);
        await open(a, vfs, name);
        await open(b, vfs, name);
        const started = Date.now();
        const write = (page: Page, tag: string) =>
            within(
                T.write,
                page.evaluate(([t, n]) => window.bench.write(t, n), [tag, TAB_WRITES] as const),
                `write ${tag}`,
            );
        await Promise.all([write(a, "A"), write(b, "B")]);
        result.wallMs = Date.now() - started;
        result.seenByA = await within(
            T.read,
            a.evaluate(() => window.bench.notesByTab()),
            "notes A",
        );
        result.seenByB = await within(
            T.read,
            b.evaluate(() => window.bench.notesByTab()),
            "notes B",
        );
        result.integrity = await within(
            T.read,
            a.evaluate(() => window.bench.integrity()),
            "integrity",
        );
        await closeDatabase(a);
        await closeDatabase(b);
        const full = (seen: Record<string, number> | undefined) =>
            seen?.A === TAB_WRITES && seen.B === TAB_WRITES;
        result.passed = full(result.seenByA) && full(result.seenByB) && result.integrity === "ok";
    } catch (error) {
        result.error = message(error);
        logs.write(`[bench] ${result.error}`);
    }
    await dropContext(context);
    return result;
}

async function reloadLoop(mode: string, browser: Browser, vfs: string): Promise<ReloadLoop> {
    const result: ReloadLoop = { opens: [], wrongRows: 0 };
    const context = await makeContext(mode, browser, `${vfs}-reloads`);
    const page = await firstPage(context.context);
    const logs = attachLogs(page, `${vfs}-${mode}-reloads.log`);
    const name = unique("reloads");
    try {
        await load(page);
        await open(page, vfs, name);
        await populate(page);
        for (let k = 0; k < RELOADS; k++) {
            await reload(page);
            result.opens.push((await open(page, vfs, name)).ms);
            if ((await total(page)) !== rows) result.wrongRows++;
        }
        await closeDatabase(page);
    } catch (error) {
        result.error = message(error);
        logs.write(`[bench] ${result.error}`);
    }
    await dropContext(context);
    return result;
}

async function relaunch(vfs: string): Promise<Relaunch> {
    const result: Relaunch = {};
    const profile = mkdtempSync(join(tmpdir(), `bench-${vfs}-relaunch-`));
    const name = unique("relaunch");
    const file = `${vfs}-relaunch.log`;
    let context = await launchProfile(profile);
    await wipe(context, file);
    let page = await firstPage(context);
    let logs = attachLogs(page, file);
    try {
        await load(page);
        await open(page, vfs, name);
        await populate(page);
        await reload(page);
        await open(page, vfs, name);
        result.rowsAfterReload = await total(page);
        await closeDatabase(page);
    } catch (error) {
        result.error = message(error);
        logs.write(`[bench] ${result.error}`);
    }
    await quietly("context close", () => context.close());
    if (!result.error) {
        context = await launchProfile(profile);
        page = await firstPage(context);
        logs = attachLogs(page, file);
        try {
            await load(page);
            result.reopenAfterRelaunch = (await open(page, vfs, name)).ms;
            result.rowsAfterRelaunch = await total(page);
            result.before = await storage(page);
            result.clearMs = (
                await within(
                    T.populate,
                    page.evaluate(() => window.bench.clear()),
                    "clear",
                )
            ).ms;
            result.rowsAfterClear = await total(page);
            result.afterClear = await storage(page);
            await within(
                T.populate,
                page.evaluate(() => window.bench.vacuum()),
                "vacuum",
            );
            result.afterVacuum = await storage(page);
            await closeDatabase(page);
        } catch (error) {
            result.error = message(error);
            logs.write(`[bench] ${result.error}`);
        }
        for (const open of context.pages()) await quietly("page close", () => open.close());
        await wipe(context, file);
        await quietly("context close", () => context.close());
    }
    rmSync(profile, { recursive: true, force: true });
    return result;
}

// G2: a script navigation while the first checkpoint is being written, then a first sync on the next page.
async function crashRun(context: BrowserContext, vfs: string, run: number): Promise<CrashRun> {
    const result: CrashRun = { run, crashed: false };
    const page = await context.newPage();
    const logs = attachLogs(page, `${vfs}-crash-${run}.log`);
    const name = unique("crash");
    try {
        await load(page);
        await open(page, vfs, name);
        await page.evaluate(() => {
            window.bench.startPopulate();
        });
        await page.waitForFunction(
            () => {
                const { applied, lines } = window.bench.progress();
                return lines > 0 && applied >= lines / 3;
            },
            null,
            { timeout: T.populate },
        );
        result.appliedBeforeNavigation = await page.evaluate(() => window.bench.progress().applied);
        await page.evaluate(() => {
            location.assign("/?navigated");
        });
        await page.waitForURL(/navigated/, { timeout: T.misc });
        await ready(page);
        result.reopen = (await open(page, vfs, name)).ms;
        result.checkpoint = (await populate(page)).ms;
        result.rows = await total(page);
        result.integrity = await within(
            T.read,
            page.evaluate(() => window.bench.integrity()),
            "integrity",
        );
        await closeDatabase(page);
        await within(
            T.misc,
            page.evaluate(() => window.bench.wipe()),
            "wipe",
        );
    } catch (error) {
        result.error = message(error);
        logs.write(`[bench] ${result.error}`);
    }
    result.crashed = logs.crashed();
    await quietly("page close", () => page.close());
    return result;
}

async function crashScenario(vfs: string): Promise<CrashRun[]> {
    const runs: CrashRun[] = [];
    const profile = mkdtempSync(join(tmpdir(), `bench-${vfs}-crash-`));
    let context = await launchProfile(profile);
    await wipe(context, `${vfs}-crash.log`);
    for (let run = 0; run < CRASH_RUNS; run++) {
        const result = await crashRun(context, vfs, run);
        runs.push(result);
        log(
            vfs,
            "crash scenario",
            `run ${run}`,
            result.crashed
                ? "CRASHED"
                : (result.error?.split("\n")[0] ??
                      `reopen ${result.reopen?.toFixed(0) ?? "?"} checkpoint ${result.checkpoint?.toFixed(0) ?? "?"}`),
        );
        if (result.crashed || result.error) {
            await quietly("context close", () => context.close());
            context = await launchProfile(profile);
            await wipe(context, `${vfs}-crash.log`);
        }
    }
    await wipe(context, `${vfs}-crash.log`);
    await quietly("context close", () => context.close());
    rmSync(profile, { recursive: true, force: true });
    return runs;
}

function median(values: number[]): number | undefined {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (!sorted.length) return undefined;
    return sorted.length % 2
        ? sorted[middle]
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

async function main(): Promise<void> {
    const dist = await build(args["no-build"]);
    const server = await serve(dist);
    url = server.url;
    log(`serving ${url}, writing ${OUT}`);
    const browser = await engine.type.launch(launchOptions);
    const results: Results = {
        stamp: new Date().toISOString(),
        label: args.label,
        machine: machine(),
        browser: {
            name: args.browser,
            channel: engine.channel,
            version: browser.version(),
            headed: args.headed,
        },
        packages: packages(),
        dataset: { business: "", rows: 0 },
        env: {},
        wasm: {
            web: args["web-dist"] ? wasmSizes(join(args["web-dist"], "assets")) : null,
            bench: wasmSizes(join(dist, "assets")),
        },
        vfs: {},
    };
    const save = () => {
        writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
        writeFileSync(join(OUT, "tables.md"), render(results));
    };
    try {
        {
            const context = await browser.newContext();
            const page = await context.newPage();
            await load(page);
            results.env = await page.evaluate(() => window.bench.env());
            results.dataset = await page.evaluate(() => window.bench.dataset());
            rows = results.dataset.rows;
            await context.close();
        }
        log(args.browser, browser.version());
        for (const vfs of VFS_LIST) {
            const vr: VfsResult = { modes: {} };
            results.vfs[vfs] = vr;
            for (const mode of MODES) {
                const mr: ModeResult = { timing: [], tabs: [] };
                vr.modes[mode] = mr;
                for (let run = 0; run < RUNS; run++) {
                    const r = await timingRun(mode, browser, vfs, run);
                    mr.timing.push(r);
                    log(
                        vfs,
                        mode,
                        `run ${run}`,
                        r.error?.split("\n")[0] ??
                            `open ${r.coldOpen?.toFixed(0) ?? "?"} checkpoint ${r.checkpoint?.toFixed(0) ?? "?"} reopen ${r.reopen?.toFixed(0) ?? "?"} rows ${r.rowsAfterReload ?? "?"}`,
                    );
                    if (run === 0 && r.coldOpen === undefined) break;
                }
                const opens = mr.timing.some((r) => r.coldOpen !== undefined);
                if (!args["skip-behaviour"] && opens) {
                    for (let run = 0; run < TAB_RUNS; run++) {
                        const r = await twoTabs(mode, browser, vfs, run);
                        mr.tabs.push(r);
                        if (r.error && run === 0) break;
                    }
                    log(
                        vfs,
                        mode,
                        "two tabs",
                        `${mr.tabs.filter((t) => t.passed).length}/${mr.tabs.length}`,
                    );
                    mr.reloads = await reloadLoop(mode, browser, vfs);
                    log(
                        vfs,
                        mode,
                        "reloads",
                        mr.reloads.error?.split("\n")[0] ??
                            mr.reloads.opens.map((o) => o.toFixed(0)).join(","),
                    );
                }
                save();
            }
            if (!args["skip-behaviour"] && MODES.includes("profile")) {
                const result = await relaunch(vfs);
                vr.relaunch = result;
                log(
                    vfs,
                    "relaunch and clear",
                    result.error?.split("\n")[0] ??
                        `relaunch ${result.rowsAfterRelaunch ?? "?"} rows, cleared to ${result.rowsAfterClear ?? "?"}`,
                );
            }
            if (CRASH_RUNS > 0 && CRASH_VFS.includes(vfs)) {
                vr.crash = await crashScenario(vfs);
            }
            save();
        }
    } finally {
        save();
        await quietly("browser close", () => browser.close());
        await server.close();
        log(`results in ${OUT}`);
    }
}

await main();
