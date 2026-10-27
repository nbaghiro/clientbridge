// emitted by static imports but never loaded: the encryption builds (no key) and VFSs we don't open
const UNLOADED = ["mc-wa-sqlite", "mc-wa-sqlite-async", "AccessHandlePoolVFS", "OPFSWriteAheadVFS"];

function precached(file: string): boolean {
    if (file.endsWith(".map")) return false;
    const name = file.slice(file.lastIndexOf("/") + 1);
    return !UNLOADED.some((build) => new RegExp(`^${build}-[\\w-]{8}\\.(js|wasm)$`).test(name));
}

export function precacheAssets(files: string[]): string[] {
    return [...new Set(["/index.html", ...files.filter(precached).map((file) => `/${file}`)])];
}
