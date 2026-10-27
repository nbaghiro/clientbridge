// Runs in a worker: tells the page whether this browser grants the OPFS sync access the replica needs.
type ProbeFile = ".clientbridge-opfs-probe";

interface SyncAccessFile extends FileSystemFileHandle {
    createSyncAccessHandle: () => Promise<{ close: () => void }>;
}

async function opfsSyncAccess(): Promise<boolean> {
    const name: ProbeFile = ".clientbridge-opfs-probe";
    try {
        const root = await navigator.storage.getDirectory();
        const file = (await root.getFileHandle(name, { create: true })) as SyncAccessFile;
        const handle = await file.createSyncAccessHandle();
        handle.close();
        await root.removeEntry(name);
        return true;
    } catch {
        return false;
    }
}

// the page sweeps probe files left by a terminated worker only while no probe holds this lock
navigator.locks
    .request(".clientbridge-opfs-probe", { mode: "shared" }, opfsSyncAccess)
    .then((granted) => {
        postMessage(granted);
    })
    .catch(() => {
        postMessage(false);
    });
