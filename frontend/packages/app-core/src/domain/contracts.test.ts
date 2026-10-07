import { describe, expect, it } from "vitest";

import { type SignatureRequest, signedText } from "./contracts";

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
    contract_name: "Waiver",
    version: 2,
    state: signedBody === null ? "pending" : "signed",
});

describe("signedText", () => {
    it("shows the current text until the client signs", () => {
        expect(signedText(request(null), "Current terms")).toBe("Current terms");
    });

    it("shows the snapshot the client signed without its signed-by line", () => {
        expect(
            signedText(
                request("I agree.\n\nTo the terms.\n\n— Signed by Ann on Oct 1"),
                "Newer terms",
            ),
        ).toBe("I agree.\n\nTo the terms.");
        expect(signedText(request("I agree."), "Newer terms")).toBe("I agree.");
        expect(signedText(request(""), "Newer terms")).toBe("");
    });

    it("cuts only at the last signed-by line", () => {
        const body = "Quote: \n\n— Signed by nobody\n\nEnd\n\n— Signed by Ann";
        expect(signedText(request(body), "")).toBe("Quote: \n\n— Signed by nobody\n\nEnd");
    });
});
