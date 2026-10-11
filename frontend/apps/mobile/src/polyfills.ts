/* eslint-disable */
// @ts-nocheck
import "@azure/core-asynciterator-polyfill";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-listformat/polyfill.js";
import "@formatjs/intl-listformat/locale-data/en.js";
import "@formatjs/intl-listformat/locale-data/en-CA.js";

// Hermes lacks NumberFormat.formatToParts and DateTimeFormat.formatRange, and formats unlike the web.
const deviceZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
require("@formatjs/intl-numberformat/polyfill-force.js");
require("@formatjs/intl-numberformat/locale-data/en.js");
require("@formatjs/intl-numberformat/locale-data/en-CA.js");
require("@formatjs/intl-datetimeformat/polyfill-force.js");
require("@formatjs/intl-datetimeformat/locale-data/en.js");
require("@formatjs/intl-datetimeformat/locale-data/en-CA.js");
require("@formatjs/intl-datetimeformat/add-all-tz.js");
Intl.DateTimeFormat.__setDefaultTimeZone(deviceZone);

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
    fetch: (input, init) => rnFetch(input, { ...init, reactNative: { textStreaming: true } }),
});

if (typeof global.btoa === "undefined") global.btoa = btoaPolyfill;
if (typeof global.atob === "undefined") global.atob = atobPolyfill;

if (typeof global.crypto.randomUUID !== "function") {
    global.crypto.randomUUID = () => {
        const bytes = global.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
}
