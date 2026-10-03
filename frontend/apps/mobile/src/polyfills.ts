/* eslint-disable */
// @ts-nocheck
import "@azure/core-asynciterator-polyfill";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";

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
