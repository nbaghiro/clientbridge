// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { formatDate, formatDateTime, parseTimestamp } from "../datetime";
import { strings } from "../strings";
import {
    type SignatureRequest,
    signatureActivity,
    signatureHistory,
    signedCopyFile,
    signedCopyText,
    signedCopyTitle,
    signedText,
    useContractDraft,
    useNewContract,
    useSignatureActions,
} from "./contracts";
import { registerReviewHost } from "./previews";

afterEach(cleanup);

const ZONE = "America/Vancouver";

const request = (signedBody: string | null): SignatureRequest => ({
    id: "sig_1",
    contract_id: "con_1",
    client_id: "cl_ann",
    client_name: "Ann",
    status: signedBody === null ? "pending" : "signed",
    token: "t1",
    sent_at: "2026-10-01T12:00:00Z",
    opened_at: null,
    signed_at: null,
    signer_ip: null,
    method: null,
    typed_name: null,
    strokes: null,
    contract_version: 2,
    signed_body: signedBody,
    declined_at: null,
    contract_name: "Waiver",
    version: 2,
    state: signedBody === null ? "pending" : "signed",
});

const declined: SignatureRequest = {
    ...request(null),
    status: "declined",
    state: "declined",
    opened_at: "2026-10-02T15:00:00Z",
    declined_at: "2026-10-05T18:30:00Z",
};

const signed: SignatureRequest = {
    ...request("Pickup\nBy 6 pm."),
    opened_at: "2026-10-02T15:00:00Z",
    signed_at: "2026-10-02T15:05:00Z",
    signer_ip: "203.0.113.7",
    method: "typed",
    typed_name: "Ann Lee",
    contract_version: 1,
    version: 1,
};

function api(post: ApiLike["post"]): ApiLike {
    return { get: vi.fn(), getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
}

// the first attempt's answer is lost after the server saved it; the retry must carry its key
function lostOnce(): { post: ApiLike["post"]; keys: (string | undefined)[] } {
    const keys: (string | undefined)[] = [];
    const post = vi.fn((_path: string, _body: unknown, opts?: { idempotencyKey?: string }) => {
        keys.push(opts?.idempotencyKey);
        return keys.length === 1
            ? Promise.reject(new TypeError("Failed to fetch"))
            : Promise.resolve({ id: "con_new" });
    });
    return { post: post as ApiLike["post"], keys };
}

describe("signedText", () => {
    it("shows the current text until the client signs", () => {
        expect(signedText(request(null), "Current terms")).toBe("Current terms");
    });

    it("shows the text the client agreed to, not newer terms", () => {
        expect(signedText(request("I agree.\n\nTo the terms."), "Newer terms")).toBe(
            "I agree.\n\nTo the terms.",
        );
        expect(signedText(request(""), "Newer terms")).toBe("");
    });
});

describe("a declined request", () => {
    it("is dated by when it was declined, not when it was opened", () => {
        const when = parseTimestamp(declined.declined_at ?? "");
        expect(signatureActivity(declined, ZONE)).toBe(
            strings.contracts.activity.declined(formatDate(when, ZONE)),
        );
        expect(signatureHistory(declined, ZONE).at(-1)).toMatchObject({
            key: "declined",
            at: formatDateTime(when, ZONE),
        });
    });

    it("falls back to when it was opened if it has no decline time", () => {
        const undated = { ...declined, declined_at: null };
        expect(signatureActivity(undated, ZONE)).toBe(
            strings.contracts.activity.declined(
                formatDate(parseTimestamp("2026-10-02T15:00:00Z"), ZONE),
            ),
        );
    });
});

describe("signedCopyTitle and signedCopyFile", () => {
    it("name the copy after its contract and signer, safe to save as a file", () => {
        const slashed = { ...signed, contract_name: 'Pickup/drop-off: "terms"' };
        expect(signedCopyTitle(slashed)).toBe(
            strings.contracts.signedCopyTitle('Pickup/drop-off: "terms"', "Ann Lee"),
        );
        const file = signedCopyFile(slashed);
        expect(file.endsWith(".txt")).toBe(true);
        expect(file).not.toMatch(/[\\/:*?"<>|]/);
    });

    it("fall back to the client's name before the request is signed", () => {
        expect(signedCopyTitle(request(null))).toBe(
            strings.contracts.signedCopyTitle("Waiver", "Ann"),
        );
    });
});

describe("signedCopyText", () => {
    it("carries the signed text with its signer, time, IP address and version", () => {
        const text = signedCopyText(signed, "Newer terms", "Birchbark", ZONE);
        const lines = text.split("\n");
        expect(lines.slice(0, 3)).toEqual(["Birchbark", "Waiver", strings.contracts.version(1)]);
        expect(text).toContain("Pickup\nBy 6 pm.");
        expect(text).not.toContain("Newer terms");
        expect(lines).toContain("Ann Lee");
        for (const value of [
            formatDateTime(parseTimestamp("2026-10-02T15:05:00Z"), ZONE),
            "203.0.113.7",
            strings.contracts.method.typed,
            "SIG_1",
        ])
            expect(text).toContain(value);
    });

    it("has no signature block until the client signs", () => {
        expect(signedCopyText(request(null), "Terms", "Birchbark", ZONE)).not.toContain(
            strings.contracts.signatureHeading,
        );
    });
});

describe("a write whose answer was lost", () => {
    it("creates a contract once when the owner saves again", async () => {
        const { post, keys } = lostOnce();
        const created = vi.fn();
        const { result } = renderHook(() => useNewContract(api(post), created));
        act(() => {
            result.current.setName("Waiver");
        });
        act(() => {
            result.current.setBody("Terms");
        });
        act(() => {
            result.current.create();
        });
        await waitFor(() => {
            expect(result.current.problem).toBe("failed");
        });
        act(() => {
            result.current.create();
        });
        await waitFor(() => {
            expect(created).toHaveBeenCalledWith("con_new");
        });
        expect(keys).toHaveLength(2);
        expect(keys[1]).toBe(keys[0]);
    });

    it("publishes a version once, and the next publish is a new command", async () => {
        const { post, keys } = lostOnce();
        const published = vi.fn();
        const contract = { id: "con_1", body: "Old", version: 1 };
        const { result } = renderHook(() => useContractDraft(api(post), contract, published));
        act(() => {
            result.current.setBody("New");
        });
        act(() => {
            result.current.publish();
        });
        await waitFor(() => {
            expect(result.current.failed).toBe(true);
        });
        act(() => {
            result.current.publish();
        });
        await waitFor(() => {
            expect(published).toHaveBeenCalledTimes(1);
        });
        act(() => {
            result.current.publish();
        });
        await waitFor(() => {
            expect(keys).toHaveLength(3);
        });
        expect(keys[1]).toBe(keys[0]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it("resends a link once when the owner tries again", async () => {
        const stop = registerReviewHost(() => Promise.resolve("confirm"));
        const { post, keys } = lostOnce();
        const { result } = renderHook(() =>
            useSignatureActions(api(post), "https://book", vi.fn()),
        );
        const waiting = request(null);
        try {
            act(() => {
                result.current.resend(waiting);
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.contracts.actionFailed);
            });
            act(() => {
                result.current.resend(waiting);
            });
            await waitFor(() => {
                expect(result.current.resent.has("sig_1")).toBe(true);
            });
            expect(keys).toHaveLength(2);
            expect(keys[1]).toBe(keys[0]);
        } finally {
            stop();
        }
    });

    it("keeps each request's key, so a retry after resending another row still replays", async () => {
        const stop = registerReviewHost(() => Promise.resolve("confirm"));
        const { post, keys } = lostOnce();
        const { result } = renderHook(() =>
            useSignatureActions(api(post), "https://book", vi.fn()),
        );
        const first = request(null);
        const second = { ...request(null), id: "sig_2" };
        try {
            act(() => {
                result.current.resend(first);
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.contracts.actionFailed);
            });
            act(() => {
                result.current.resend(second);
            });
            await waitFor(() => {
                expect(result.current.resent.has("sig_2")).toBe(true);
            });
            act(() => {
                result.current.resend(first);
            });
            await waitFor(() => {
                expect(result.current.resent.has("sig_1")).toBe(true);
            });
            expect(keys).toHaveLength(3);
            expect(keys[1]).not.toBe(keys[0]);
            expect(keys[2]).toBe(keys[0]);
        } finally {
            stop();
        }
    });
});
