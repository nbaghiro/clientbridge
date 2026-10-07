import { useState } from "react";

import { useAsyncAction } from "../hooks";
import type { SignatureStrokes } from "../ui";
import { type PublicBrand, usePublicResource } from "./publicResource";

export interface PublicContract {
    contract_name: string;
    business_name: string;
    brand: PublicBrand;
    body: string;
    signer_name: string | null;
    status: string;
    version: number;
    signed_at: string | null;
    signer_ip: string | null;
    method: string | null;
    typed_name: string | null;
    strokes: SignatureStrokes | null;
}

interface SignInput {
    typed_name: string;
    strokes: SignatureStrokes | null;
    agreed: boolean;
}

class PublicContractError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicContractError";
    }
}

interface PublicContractClient {
    getContract: (token: string) => Promise<PublicContract>;
    sign(token: string, input: SignInput): Promise<PublicContract>;
    decline(token: string): Promise<PublicContract>;
}

export function createPublicContractClient(baseUrl: string): PublicContractClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicContractError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };

    return {
        getContract: (token) => request<PublicContract>(`/contract/${encodeURIComponent(token)}`),
        sign: (token, input) =>
            request<PublicContract>(`/contract/${encodeURIComponent(token)}/sign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            }),
        decline: (token) =>
            request<PublicContract>(`/contract/${encodeURIComponent(token)}/decline`, {
                method: "POST",
            }),
    };
}

type SignMode = "type" | "draw";
type SigningError = "name-missing" | "drawing-missing" | "consent-missing" | "failed";

interface ContractSigning {
    status: "loading" | "not-found" | "error" | "pending" | "signed" | "declined";
    doc: PublicContract | null;
    mode: SignMode;
    setMode: (m: SignMode) => void;
    typedName: string;
    setTypedName: (v: string) => void;
    strokes: SignatureStrokes;
    setStrokes: (s: SignatureStrokes) => void;
    agreed: boolean;
    setAgreed: (v: boolean) => void;
    sign: () => void;
    decline: () => void;
    busy: boolean;
    error: SigningError | null;
    retry: () => void;
}

/** Typed or drawn: a drawing still needs the printed name, and agreeing is required either way. */
export function useContractSigning(
    contracts: PublicContractClient,
    token: string,
): ContractSigning {
    const {
        status: load,
        data: doc,
        setData,
        retry,
    } = usePublicResource(contracts.getContract, token);
    const [mode, setModeRaw] = useState<SignMode>("type");
    const [typed, setTyped] = useState<string | null>(null);
    const [strokes, setStrokesRaw] = useState<SignatureStrokes>([]);
    const [agreed, setAgreedRaw] = useState(false);
    const [problem, setProblem] = useState<SigningError | null>(null);
    const action = useAsyncAction();
    const typedName = typed ?? doc?.signer_name ?? "";
    const status: ContractSigning["status"] =
        load !== "ready"
            ? load
            : doc === null
              ? "error"
              : doc.status === "signed" || doc.status === "declined"
                ? doc.status
                : "pending";

    return {
        status,
        doc,
        mode,
        setMode: (m) => {
            setProblem(null);
            setModeRaw(m);
        },
        typedName,
        setTypedName: (v) => {
            setProblem(null);
            setTyped(v);
        },
        strokes,
        setStrokes: (v) => {
            setProblem(null);
            setStrokesRaw(v);
        },
        agreed,
        setAgreed: (v) => {
            setProblem(null);
            setAgreedRaw(v);
        },
        sign: () => {
            if (typedName.trim() === "") {
                setProblem("name-missing");
                return;
            }
            if (mode === "draw" && strokes.length === 0) {
                setProblem("drawing-missing");
                return;
            }
            if (!agreed) {
                setProblem("consent-missing");
                return;
            }
            setProblem(null);
            action.run(async () => {
                setData(
                    await contracts.sign(token, {
                        typed_name: typedName.trim(),
                        strokes: mode === "draw" ? strokes : null,
                        agreed,
                    }),
                );
            });
        },
        decline: () => {
            action.run(async () => {
                setData(await contracts.decline(token));
            });
        },
        busy: action.busy,
        error: problem ?? (action.error === null ? null : "failed"),
        retry,
    };
}

/** Contract text as clauses: a heading line then its text; a one-line block is plain text. */
export function contractClauses(body: string): { heading: string; text: string }[] {
    return body
        .split(/\n\s*\n/)
        .map((block) => {
            const [first = "", ...rest] = block.trim().split("\n");
            return rest.length === 0
                ? { heading: "", text: first }
                : { heading: first, text: rest.join(" ") };
        })
        .filter((c) => c.heading !== "" || c.text !== "");
}
