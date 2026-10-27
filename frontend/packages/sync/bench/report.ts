export interface Probe {
    granted: boolean | null;
    error: string | null;
    ms: number;
}

export interface Size {
    file: string;
    bytes: number;
}

export interface TimingRun {
    run: number;
    error?: string;
    crashed?: boolean;
    probe?: Probe;
    coldOpen?: number | undefined;
    multiTabs?: boolean;
    checkpoint?: number | undefined;
    readFirst?: number | undefined;
    read?: number | undefined;
    ledgerRead?: number | undefined;
    sqliteBytes?: number | undefined;
    usageBytes?: number | undefined;
    reopen?: number | undefined;
    rowsAfterReload?: number | undefined;
}

export interface TabsRun {
    run: number;
    error?: string;
    passed: boolean;
    wallMs?: number;
    seenByA?: Record<string, number>;
    seenByB?: Record<string, number>;
    integrity?: string;
}

export interface ReloadLoop {
    error?: string;
    opens: number[];
    wrongRows: number;
}

export interface Storage {
    estimate: { usage: number | null; quota: number | null };
    sqlite: { bytes: number; freeBytes: number } | null;
}

export interface Relaunch {
    error?: string;
    rowsAfterReload?: number;
    reopenAfterRelaunch?: number;
    rowsAfterRelaunch?: number;
    clearMs?: number;
    rowsAfterClear?: number;
    before?: Storage;
    afterClear?: Storage;
    afterVacuum?: Storage;
}

export interface CrashRun {
    run: number;
    crashed: boolean;
    error?: string;
    appliedBeforeNavigation?: number;
    reopen?: number;
    checkpoint?: number;
    rows?: number;
    integrity?: string;
}

export interface ModeResult {
    timing: TimingRun[];
    tabs: TabsRun[];
    reloads?: ReloadLoop;
}

export interface VfsResult {
    modes: Record<string, ModeResult>;
    relaunch?: Relaunch;
    crash?: CrashRun[];
}

export interface Results {
    stamp: string;
    label: string;
    machine: Record<string, string | number>;
    browser: { name: string; channel: string | null; version: string; headed: boolean };
    packages: Record<string, string>;
    dataset: { business: string; rows: number };
    env: Record<string, unknown>;
    wasm: { web: Size[] | null; bench: Size[] };
    vfs: Record<string, VfsResult>;
}

function median(values: number[]): number | null {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    const upper = sorted[middle] ?? 0;
    return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function numbers(values: (number | undefined)[]): number[] {
    return values.filter((value): value is number => typeof value === "number");
}

function spread(values: (number | undefined)[], digits = 0): string {
    const list = numbers(values);
    const middle = median(list);
    if (middle === null) return "–";
    return `${middle.toFixed(digits)} (${Math.min(...list).toFixed(digits)} to ${Math.max(...list).toFixed(digits)})`;
}

function megabytes(bytes: number | null | undefined): string {
    return typeof bytes === "number" ? (bytes / 2 ** 20).toFixed(1) : "–";
}

function firstLine(error: string | undefined): string {
    return (
        (error ?? "")
            .split("\n")[0]
            ?.replace(/^page\.evaluate: /, "")
            .slice(0, 100) ?? ""
    );
}

function row(cells: (string | number)[]): string {
    return `| ${cells.map((cell) => String(cell).replaceAll("|", "/")).join(" | ")} |`;
}

function table(header: string[], rows: (string | number)[][]): string[] {
    return [row(header), row(header.map(() => "---")), ...rows.map(row)];
}

export function render(results: Results): string {
    const out: string[] = [];
    const { browser, machine, packages, dataset } = results;
    const channel = browser.channel ? ` (${browser.channel})` : "";
    out.push(`## ${results.label}: ${browser.name}${channel} ${browser.version}`, "");
    out.push(
        `Run ${results.stamp} on ${String(machine.os)}, ${String(machine.cpu)}, ${String(machine.cores)} cores, ${String(machine.memoryGB)} GB, Node ${String(machine.node)}. ${packages["@powersync/web"] ? `@powersync/web ${packages["@powersync/web"]}` : ""}, @journeyapps/wa-sqlite ${packages["@journeyapps/wa-sqlite"] ?? "?"}, Playwright ${packages["@playwright/test"] ?? "?"}${browser.headed ? ", headed" : ", headless"}. One first checkpoint of ${dataset.rows} rows (${dataset.business}). Times in ms, as the median (min to max).`,
        "",
    );

    const timing: (string | number)[][] = [];
    const behaviour: (string | number)[][] = [];
    for (const [vfs, result] of Object.entries(results.vfs)) {
        for (const [mode, mr] of Object.entries(result.modes)) {
            const ok = mr.timing.filter((r) => !r.error);
            const probes = mr.timing.map((r) => r.probe);
            const granted = probes.filter((p) => p?.granted === true).length;
            const probe = `${spread(probes.map((p) => p?.ms))}, ${granted}/${probes.length} granted`;
            if (!ok.length) {
                timing.push([
                    vfs,
                    mode,
                    `0/${mr.timing.length}`,
                    probe,
                    `fails: ${firstLine(mr.timing[0]?.error)}`,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ]);
            } else {
                timing.push([
                    vfs,
                    mode,
                    `${ok.length}/${mr.timing.length}`,
                    probe,
                    spread(ok.map((r) => r.coldOpen)),
                    spread(ok.map((r) => r.checkpoint)),
                    spread(
                        ok.map((r) => r.read),
                        1,
                    ),
                    spread(
                        ok.map((r) => r.ledgerRead),
                        1,
                    ),
                    spread(ok.map((r) => r.reopen)),
                    megabytes(median(numbers(ok.map((r) => r.sqliteBytes)))),
                    megabytes(median(numbers(ok.map((r) => r.usageBytes)))),
                    ok[0]?.multiTabs ? "yes" : "no",
                ]);
            }
            const tabs = mr.tabs.length
                ? `${mr.tabs.filter((t) => t.passed).length}/${mr.tabs.length}${mr.tabs.find((t) => t.error) ? `, first error: ${firstLine(mr.tabs.find((t) => t.error)?.error)}` : ""}`
                : "–";
            const loop = mr.reloads;
            let reloads = "–";
            if (loop) {
                const range = loop.opens.length
                    ? `${Math.min(...loop.opens).toFixed(0)} to ${Math.max(...loop.opens).toFixed(0)} ms`
                    : "";
                reloads = loop.error
                    ? `${loop.opens.length} then ${firstLine(loop.error)}`
                    : `${loop.opens.length} opened, ${range}${loop.wrongRows ? `, ${loop.wrongRows} without every row` : ""}`;
            }
            const relaunch =
                mode !== "profile" || !result.relaunch
                    ? "n/a"
                    : result.relaunch.rowsAfterRelaunch === dataset.rows
                      ? `yes, reopened in ${result.relaunch.reopenAfterRelaunch?.toFixed(0) ?? "?"} ms`
                      : `no: ${result.relaunch.rowsAfterRelaunch ?? firstLine(result.relaunch.error)}`;
            behaviour.push([vfs, mode, tabs, reloads, relaunch]);
        }
    }
    out.push("### Timings", "");
    out.push(
        ...table(
            [
                "VFS",
                "context",
                "ok",
                "probe ms",
                "cold open",
                "first checkpoint",
                "list read",
                "ledger read",
                "reopen after reload",
                "SQLite MB",
                "usage MB",
                "multi-tab",
            ],
            timing,
        ),
        "",
    );
    out.push("### Behaviour", "");
    out.push(
        ...table(
            ["VFS", "context", "two writing tabs passed", "reloads", "kept after relaunch"],
            behaviour,
        ),
        "",
    );

    const clears = Object.entries(results.vfs).filter(([, r]) => r.relaunch?.before);
    if (clears.length) {
        out.push("### disconnectAndClear on the on-disk profile", "");
        out.push(
            ...table(
                [
                    "VFS",
                    "rows after",
                    "SQLite MB before, after (free MB)",
                    "usage MB before, after clear, after VACUUM",
                ],
                clears.map(([vfs, { relaunch }]) => [
                    vfs,
                    relaunch?.rowsAfterClear ?? "–",
                    `${megabytes(relaunch?.before?.sqlite?.bytes)}, ${megabytes(relaunch?.afterClear?.sqlite?.bytes)} (${megabytes(relaunch?.afterClear?.sqlite?.freeBytes)})`,
                    `${megabytes(relaunch?.before?.estimate.usage)}, ${megabytes(relaunch?.afterClear?.estimate.usage)}, ${megabytes(relaunch?.afterVacuum?.estimate.usage)}`,
                ]),
            ),
            "",
        );
    }

    const crashes = Object.entries(results.vfs).filter(([, r]) => r.crash?.length);
    if (crashes.length) {
        out.push("### Script navigation during the first checkpoint", "");
        out.push(
            ...table(
                [
                    "VFS",
                    "runs",
                    "renderer crashes",
                    "other failures",
                    "reopen after navigation",
                    "checkpoint after navigation",
                ],
                crashes.map(([vfs, { crash = [] }]) => {
                    const failed = crash.filter((r) => !r.crashed && r.error);
                    return [
                        vfs,
                        crash.length,
                        crash.filter((r) => r.crashed).length,
                        failed.length
                            ? `${failed.length}, first: ${firstLine(failed[0]?.error)}`
                            : 0,
                        spread(crash.map((r) => r.reopen)),
                        spread(crash.map((r) => r.checkpoint)),
                    ];
                }),
            ),
            "",
        );
    }

    const wasm = results.wasm.web ?? results.wasm.bench;
    out.push(`### Built wasm (${results.wasm.web ? "web app build" : "bench build"})`, "");
    out.push(
        ...table(
            ["file", "MB"],
            [
                ...wasm.map((w) => [w.file, megabytes(w.bytes)]),
                ["total", megabytes(wasm.reduce((sum, w) => sum + w.bytes, 0))],
            ],
        ),
        "",
    );
    return out.join("\n");
}
