declare module "base-64" {
    export function encode(input: string): string;
    export function decode(input: string): string;
}

declare module "text-encoding" {
    export const TextEncoder: typeof globalThis.TextEncoder;
    export const TextDecoder: typeof globalThis.TextDecoder;
}

declare module "react-native-fetch-api" {
    export const Headers: typeof globalThis.Headers;
    export const Request: typeof globalThis.Request;
    export const Response: typeof globalThis.Response;
    export function fetch(
        input: RequestInfo | URL,
        init?: RequestInit & { reactNative?: { textStreaming?: boolean } },
    ): Promise<globalThis.Response>;
}
