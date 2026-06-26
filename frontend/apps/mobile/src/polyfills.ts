/* eslint-disable */
// @ts-nocheck
import "@azure/core-asynciterator-polyfill";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";

import { decode as atobPolyfill, encode as btoaPolyfill } from "base-64";
import { fetch as rnFetch, Headers, Request, Response } from "react-native-fetch-api";
import { polyfillGlobal } from "react-native/Libraries/Utilities/PolyfillFunctions";
import { TextDecoder, TextEncoder } from "text-encoding";
import { ReadableStream } from "web-streams-polyfill/ponyfill/es6";

polyfillGlobal("TextEncoder", () => TextEncoder);
polyfillGlobal("TextDecoder", () => TextDecoder);
polyfillGlobal("ReadableStream", () => ReadableStream);
polyfillGlobal("Headers", () => Headers);
polyfillGlobal("Request", () => Request);
polyfillGlobal("Response", () => Response);
polyfillGlobal(
    "fetch",
    () => (input, init) => rnFetch(input, { ...init, reactNative: { textStreaming: true } }),
);

if (typeof global.btoa === "undefined") global.btoa = btoaPolyfill;
if (typeof global.atob === "undefined") global.atob = atobPolyfill;
