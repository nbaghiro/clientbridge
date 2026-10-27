const SUFFIXES = ["", "-journal", "-wal"];

function missing(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
}

/** Removes a replica's OPFS files only while no connection holds them; resolves whether they're gone. */
export async function removeReplicaFiles(name: string): Promise<boolean> {
    const root = await navigator.storage.getDirectory();
    // OPFSCoopSyncVFS holds this lock for as long as any connection keeps the file's access handles.
    return navigator.locks.request(`ahp:/${name}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        let gone = true;
        for (const suffix of SUFFIXES) {
            try {
                await root.removeEntry(name + suffix);
            } catch (error) {
                if (!missing(error)) gone = false;
            }
        }
        return gone;
    });
}
