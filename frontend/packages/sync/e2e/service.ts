import { execFile } from "node:child_process";
import { promisify } from "node:util";

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set: run make test-sync`);
    return value;
}

export function endpoint(): string {
    return required("SYNC_TEST_URL");
}

export function token(role: string): string {
    const tokens = JSON.parse(required("SYNC_TEST_TOKENS")) as Record<string, string | undefined>;
    const found = tokens[role];
    if (!found) throw new Error(`no sync token for ${role}`);
    return found;
}

export function jsonEnv(name: string): unknown {
    return JSON.parse(required(name));
}

// the run's copy of a fixture id: make test-sync seeds every row under its own namespace
export function fixture(id: string): string {
    return `${id}_${required("SYNC_TEST_NAMESPACE")}`;
}

export function fixtures(ids: string[]): string[] {
    return ids.map(fixture);
}

export function seeded(id: string): string {
    const suffix = `_${required("SYNC_TEST_NAMESPACE")}`;
    return id.endsWith(suffix) ? id.slice(0, -suffix.length) : id;
}

/** Runs a `python -m e2e.sync` command against the run's database and returns its output. */
export async function backend(...args: string[]): Promise<string> {
    const python = required("SYNC_TEST_PYTHON");
    const cwd = required("SYNC_TEST_BACKEND");
    return (await promisify(execFile)(python, ["-m", "e2e.sync", ...args], { cwd })).stdout;
}
