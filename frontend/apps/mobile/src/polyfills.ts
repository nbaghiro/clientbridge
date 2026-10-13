import "@azure/core-asynciterator-polyfill";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-listformat/polyfill.js";
import "@formatjs/intl-listformat/locale-data/en.js";
import "@formatjs/intl-listformat/locale-data/en-CA.js";
// Hermes lacks formatToParts and formatRange; the date polyfill has no zone data, app-core shifts to UTC.
import "@formatjs/intl-numberformat/polyfill-force.js";
import "@formatjs/intl-numberformat/locale-data/en.js";
import "@formatjs/intl-numberformat/locale-data/en-CA.js";
import "@formatjs/intl-datetimeformat/polyfill-force.js";
import "@formatjs/intl-datetimeformat/locale-data/en.js";
import "@formatjs/intl-datetimeformat/locale-data/en-CA.js";

import { decode as atobPolyfill, encode as btoaPolyfill } from "base-64";
import { fetch as rnFetch, Headers, Request, Response } from "react-native-fetch-api";
import { TextDecoder, TextEncoder } from "text-encoding";
import { ReadableStream } from "web-streams-polyfill";

Object.assign(globalThis, {
    TextEncoder,
    TextDecoder,
    ReadableStream,
    Headers,
    Request,
    Response,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        rnFetch(input, { ...init, reactNative: { textStreaming: true } }),
});

if (typeof global.btoa === "undefined") global.btoa = btoaPolyfill;
if (typeof global.atob === "undefined") global.atob = atobPolyfill;

const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;

if (typeof global.crypto.randomUUID !== "function") {
    global.crypto.randomUUID = () => {
        const hex = Array.from(global.crypto.getRandomValues(new Uint8Array(16)), (byte, i) => {
            const marked =
                i === VERSION_BYTE
                    ? (byte & 0x0f) | 0x40
                    : i === VARIANT_BYTE
                      ? (byte & 0x3f) | 0x80
                      : byte;
            return marked.toString(16).padStart(2, "0");
        }).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
}
