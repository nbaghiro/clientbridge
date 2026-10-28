// Runs in a worker: tells the page whether this browser grants the OPFS sync access the replica needs.
type ProbePrefix = ".clientbridge-opfs-probe";
type Unnamed = "Error";

interface SyncAccessFile extends FileSystemFileHandle {
    createSyncAccessHandle: () => Promise<{ close: () => void }>;
}

const prefix: ProbePrefix = ".clientbridge-opfs-probe";
// the name a failure reports when it isn't an Error
const unnamed: Unnamed = "Error";

async function opfsSyncAccess(): Promise<{ granted: true } | { granted: false; error: string }> {
    // a name of its own, so tabs probing at once never hold each other's file
    const name = `${prefix}-${crypto.randomUUID()}`;
    try {
        const root = await navigator.storage.getDirectory();
        const file = (await root.getFileHandle(name, { create: true })) as SyncAccessFile;
        const handle = await file.createSyncAccessHandle();
        handle.close();
        await root.removeEntry(name);
        return { granted: true };
    } catch (error) {
        return { granted: false, error: error instanceof Error ? error.name : unnamed };
    }
}

// the page sweeps probe files left by a terminated worker only while no probe holds this lock
navigator.locks
    .request(prefix, { mode: "shared" }, opfsSyncAccess)
    .then((answer) => {
        postMessage(answer);
    })
    .catch((error: unknown) => {
        postMessage({ granted: false, error: error instanceof Error ? error.name : unnamed });
    });
