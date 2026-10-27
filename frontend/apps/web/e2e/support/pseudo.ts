import { messageEvidence } from "./messaging";

/** Persisted conversation text is customer content, even when it began as a quick reply. */
export async function clientMessageCopy(clientId: string): Promise<ReadonlySet<string>> {
    const evidence = await messageEvidence(clientId);
    return new Set(
        evidence.messages
            .map((message) => message.body)
            .filter((body): body is string => typeof body === "string")
            .map((body) => body.replace(/\s+/g, " ").trim()),
    );
}
