// The web app's OPFS probe (apps/web/src/lib/opfsProbe.ts), reporting why it failed.
interface SyncAccessFile extends FileSystemFileHandle {
    createSyncAccessHandle: () => Promise<{ close: () => void }>;
}

async function probe(): Promise<{ granted: boolean; error: string | null }> {
    const name = `.bench-opfs-probe-${Math.random().toString(36).slice(2, 8)}`;
    try {
        const root = await navigator.storage.getDirectory();
        const file = (await root.getFileHandle(name, { create: true })) as SyncAccessFile;
        const handle = await file.createSyncAccessHandle();
        handle.close();
        await root.removeEntry(name);
        return { granted: true, error: null };
    } catch (error) {
        return { granted: false, error: error instanceof Error ? error.name : String(error) };
    }
}

probe()
    .then((outcome) => {
        postMessage(outcome);
    })
    .catch((error: unknown) => {
        postMessage({ granted: false, error: String(error) });
    });
