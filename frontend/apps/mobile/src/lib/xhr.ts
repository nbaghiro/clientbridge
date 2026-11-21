const NULL_BODY_STATUSES = [101, 204, 205, 304];

function responseHeaders(raw: string): Headers {
    const headers = new Headers();
    for (const line of raw.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    return headers;
}

// React Native's own networking hands over the binary bodies that expo/fetch drops on iOS.
export function xhrFetch(url: string, init: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        const { body, signal } = init;
        if (body !== undefined && body !== null && typeof body !== "string") {
            reject(new Error("xhrFetch sends only text bodies"));
            return;
        }
        if (signal?.aborted) {
            reject(new Error("request aborted"));
            return;
        }
        const xhr = new XMLHttpRequest();
        const abort = (): void => {
            xhr.abort();
            reject(new Error("request aborted"));
        };
        const settle = (outcome: () => void): void => {
            signal?.removeEventListener("abort", abort);
            outcome();
        };
        xhr.open(init.method ?? "GET", url);
        xhr.responseType = "arraybuffer";
        new Headers(init.headers).forEach((value, name) => {
            xhr.setRequestHeader(name, value);
        });
        xhr.onload = () => {
            settle(() => {
                try {
                    const content = NULL_BODY_STATUSES.includes(xhr.status)
                        ? null
                        : (xhr.response as ArrayBuffer);
                    resolve(
                        new Response(content, {
                            status: xhr.status,
                            headers: responseHeaders(xhr.getAllResponseHeaders()),
                        }),
                    );
                } catch {
                    reject(new TypeError("unreadable response"));
                }
            });
        };
        xhr.onerror = () => {
            settle(() => {
                reject(new TypeError("network request failed"));
            });
        };
        xhr.ontimeout = () => {
            settle(() => {
                reject(new TypeError("network request timed out"));
            });
        };
        xhr.onabort = () => {
            settle(() => {
                reject(new Error("request aborted"));
            });
        };
        signal?.addEventListener("abort", abort, { once: true });
        xhr.send(body ?? null);
    });
}
