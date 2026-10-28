import type { OpfsProbe } from "@clientbridge/app-core";

const ANSWER_MS = 5_000;

type ProbeFailure = "Error" | "WorkerError";
const failed = (error: ProbeFailure): OpfsProbe => ({ granted: false, error });

function probeOnce(): Promise<OpfsProbe> {
    return new Promise((resolve) => {
        const worker = new Worker(new URL("./opfsProbe.ts", import.meta.url), { type: "module" });
        const answer = (probe: OpfsProbe): void => {
            clearTimeout(timer);
            worker.terminate();
            resolve(probe);
        };
        const timer = setTimeout(() => {
            answer(null);
        }, ANSWER_MS);
        worker.onmessage = (event: MessageEvent<unknown>) => {
            answer(isProbe(event.data) ? event.data : failed("Error"));
        };
        worker.onerror = () => {
            answer(failed("WorkerError"));
        };
    });
}

function isProbe(data: unknown): data is Exclude<OpfsProbe, null> {
    return (
        typeof data === "object" &&
        data !== null &&
        "granted" in data &&
        (data.granted === true || ("error" in data && typeof data.error === "string"))
    );
}

/** Whether this window grants OPFS sync access; a worker that doesn't answer gets one retry. */
export async function opfsSyncAccess(): Promise<OpfsProbe> {
    return (await probeOnce()) ?? probeOnce();
}
