import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { xhrFetch } from "./xhr";

class FakeXhr {
    static last: FakeXhr | null = null;
    method = "";
    url = "";
    responseType = "";
    headers: Record<string, string> = {};
    sent: unknown = undefined;
    aborted = false;
    status = 0;
    response: unknown = null;
    rawHeaders = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    constructor() {
        FakeXhr.last = this;
    }
    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
    }
    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }
    getAllResponseHeaders(): string {
        return this.rawHeaders;
    }
    send(body: unknown): void {
        this.sent = body;
    }
    abort(): void {
        this.aborted = true;
    }
    answer(status: number, bytes: number[], rawHeaders = ""): void {
        this.status = status;
        this.response = new Uint8Array(bytes).buffer;
        this.rawHeaders = rawHeaders;
        this.onload?.();
    }
}

function sent(): FakeXhr {
    const xhr = FakeXhr.last;
    if (xhr === null) throw new Error("no request was opened");
    return xhr;
}

beforeEach(() => {
    FakeXhr.last = null;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("xhrFetch", () => {
    it("sends the request and hands back the bytes, status and headers", async () => {
        const pending = xhrFetch("https://api.test/v1/reports/export", {
            method: "POST",
            headers: new Headers({ "Content-Type": "application/json", "X-Business-Id": "bz_1" }),
            body: '{"kinds":["income"]}',
        });
        const xhr = sent();
        expect(xhr.method).toBe("POST");
        expect(xhr.url).toBe("https://api.test/v1/reports/export");
        expect(xhr.responseType).toBe("arraybuffer");
        expect(xhr.headers).toEqual({
            "content-type": "application/json",
            "x-business-id": "bz_1",
        });
        expect(xhr.sent).toBe('{"kinds":["income"]}');
        xhr.answer(200, [0x50, 0x4b, 3, 4], "Content-Type: application/zip\r\nX-Rows: 7\r\n");
        const res = await pending;
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/zip");
        expect(res.headers.get("x-rows")).toBe("7");
        expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4]);
    });

    it("answers a no-content status with an empty body instead of hanging", async () => {
        const pending = xhrFetch("https://api.test/x", { method: "POST", body: "{}" });
        sent().answer(204, []);
        const res = await pending;
        expect(res.status).toBe(204);
        expect(res.body).toBeNull();
    });

    it("rejects a response it cannot represent", async () => {
        const pending = xhrFetch("https://api.test/x", {});
        sent().answer(0, []);
        await expect(pending).rejects.toBeInstanceOf(TypeError);
    });

    it("rejects as a connection failure on a network error or a timeout", async () => {
        const failed = xhrFetch("https://api.test/x", {});
        sent().onerror?.();
        await expect(failed).rejects.toBeInstanceOf(TypeError);
        const timedOut = xhrFetch("https://api.test/x", {});
        sent().ontimeout?.();
        await expect(timedOut).rejects.toBeInstanceOf(TypeError);
    });

    it("aborts the request with its signal and stops listening once it settles", async () => {
        const controller = new AbortController();
        const pending = xhrFetch("https://api.test/x", { signal: controller.signal });
        const xhr = sent();
        controller.abort();
        expect(xhr.aborted).toBe(true);
        await expect(pending).rejects.toThrow("request aborted");

        const later = new AbortController();
        const done = xhrFetch("https://api.test/x", { signal: later.signal });
        const answered = sent();
        answered.answer(200, [1]);
        await done;
        later.abort();
        expect(answered.aborted).toBe(false);
    });

    it("never opens a request whose signal is already aborted or whose body is not text", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(xhrFetch("https://api.test/x", { signal: controller.signal })).rejects.toThrow(
            "request aborted",
        );
        await expect(
            xhrFetch("https://api.test/x", { method: "POST", body: new Uint8Array([1]) }),
        ).rejects.toThrow("only text bodies");
        expect(FakeXhr.last).toBeNull();
    });
});
