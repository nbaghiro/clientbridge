import { usePowerSync, useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { useBusinessId } from "../hooks/primitives";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { newIdempotencyKey, newRowId } from "../util/primitives";
import type { Intent } from "../util/primitives";
import type { PublicBrand } from "./publicBrand";

export interface ContractRow {
    id: string;
    name: string;
    version: number;
    always_require: number;
    active: number;
}

const CONTRACTS_SQL =
    "SELECT id, name, version, always_require, active FROM contracts ORDER BY active DESC, name COLLATE NOCASE";

export function useContracts(): ContractRow[] {
    return useQuery<ContractRow>(CONTRACTS_SQL).data;
}

export function activeContracts(rows: ContractRow[]): ContractRow[] {
    return rows.filter((c) => c.active === 1);
}

/** Visual tone for a signature lifecycle status (pending | signed | declined | expired). */
export function signatureStatusIntent(status: string): Intent {
    switch (status) {
        case "signed":
            return "success";
        case "declined":
            return "danger";
        case "expired":
            return "neutral";
        default:
            return "warning"; // pending
    }
}

export interface SignatureResult {
    id: string;
    business_id: string;
    contract_id: string;
    client_id: string;
    status: string;
    token: string;
    signed_at: string | null;
}

export function sendContract(
    api: ApiLike,
    input: { contract_id: string; client_id: string },
): Promise<SignatureResult> {
    return api.post<SignatureResult>(
        "/v1/contracts/send",
        { contract_id: input.contract_id, client_id: input.client_id },
        { idempotencyKey: newIdempotencyKey() },
    );
}

export interface SendContractForm {
    contractId: string;
    setContractId: (v: string) => void;
    clientId: string;
    setClientId: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared "send for signature" form: pick a contract + client, then POST the send command. */
export function useSendContractForm(api: ApiLike, onSent: () => void): SendContractForm {
    const [contractId, setContractId] = useState("");
    const [clientId, setClientId] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (contractId === "") {
            setError(strings.bookingForms.selectContract);
            return;
        }
        if (clientId === "") {
            setError(strings.bookingForms.selectClient);
            return;
        }
        void run(() => sendContract(api, { contract_id: contractId, client_id: clientId }), {
            onSuccess: () => {
                setContractId("");
                setClientId("");
                onSent();
            },
            errorMessage: strings.bookingForms.sendContractError,
        });
    };

    return { contractId, setContractId, clientId, setClientId, busy, error, submit };
}

export interface ContractDraftForm {
    name: string;
    setName: (v: string) => void;
    body: string;
    setBody: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Minimal contract authoring via sync-write (`contracts` is admin-writable). Inserts a name + body;
 *  the row uploads through `/sync/upload`. A richer editor (versions, expiry) is a follow. */
export function useContractDraftForm(onCreated: () => void): ContractDraftForm {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const [name, setName] = useState("");
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (businessId === null) {
            setError(strings.common.stillSyncing);
            return;
        }
        if (name.trim().length === 0) {
            setError(strings.bookingForms.contractNameRequired);
            return;
        }
        if (body.trim().length === 0) {
            setError(strings.bookingForms.contractTextRequired);
            return;
        }
        void run(
            async () => {
                await db.execute(
                    "INSERT INTO contracts (id, business_id, name, body, version, always_require, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [newRowId("con"), businessId, name.trim(), body.trim(), 1, 0, 1],
                );
            },
            {
                onSuccess: () => {
                    setName("");
                    setBody("");
                    onCreated();
                },
                errorMessage: strings.bookingForms.saveContractError,
            },
        );
    };

    return { name, setName, body, setBody, busy, error, submit };
}

export interface PublicContract {
    contract_name: string;
    business_name: string;
    brand: PublicBrand;
    body: string;
    signer_name: string | null;
    status: string;
}

export interface SignInput {
    typed_name?: string | null;
    signature_image_id?: string | null;
}

export class PublicContractError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicContractError";
    }
}

export interface PublicContractClient {
    getContract(token: string): Promise<PublicContract>;
    sign(token: string, input: SignInput): Promise<PublicContract>;
    decline(token: string): Promise<PublicContract>;
    upload(token: string, file: Blob): Promise<string>; // returns a file_id to pass as signature_image_id
}

/** Build an e-sign client bound to the API origin (web `VITE_API_URL`), mirroring
 *  `createPublicPayClient`. */
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
                body: JSON.stringify({
                    typed_name: input.typed_name ?? null,
                    signature_image_id: input.signature_image_id ?? null,
                }),
            }),
        decline: (token) =>
            request<PublicContract>(`/contract/${encodeURIComponent(token)}/decline`, {
                method: "POST",
            }),
        upload: async (token, file) => {
            const meta = await request<{ file_id: string; upload_url: string }>(
                `/contract/${encodeURIComponent(token)}/upload`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content_type: file.type || null, size: file.size }),
                },
            );
            const headers: Record<string, string> = {};
            if (file.type) headers["Content-Type"] = file.type;
            const put = await fetch(meta.upload_url, { method: "PUT", headers, body: file });
            if (!put.ok)
                throw new PublicContractError(
                    put.status,
                    strings.bookingForms.signatureUploadFailedDetail,
                );
            return meta.file_id;
        },
    };
}

export type PublicContractStatus = "loading" | "not-found" | "error" | "resolved" | "pending";

export interface PublicContractSign {
    status: PublicContractStatus;
    contract: PublicContract | null;
    typedName: string;
    setTypedName: (v: string) => void;
    imageName: string; // the attached signature-image filename, "" if none
    uploadImage: (file: Blob, name: string) => void;
    sign: () => void;
    decline: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

/** View-model for the public e-sign page: load the contract, capture a typed name or an uploaded
 *  signature image, then sign or decline. The file `<input>`/picker stays per-platform; it hands the
 *  Blob + name to `uploadImage`. */
export function usePublicContractSign(
    contracts: PublicContractClient,
    token: string,
): PublicContractSign {
    const [contract, setContract] = useState<PublicContract | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [typedName, setTypedName] = useState("");
    const [imageId, setImageId] = useState<string | null>(null);
    const [imageName, setImageName] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        contracts
            .getContract(token)
            .then((c) => {
                if (!live) return;
                setContract(c);
                if (c.signer_name !== null) setTypedName(c.signer_name);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicContractError && err.status === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [contracts, token]);

    const status: PublicContractStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || contract === null
            ? "error"
            : contract.status !== "pending"
              ? "resolved"
              : "pending";

    const sign = (): void => {
        if (typedName.trim().length === 0 && imageId === null) {
            setError(strings.bookingForms.signPrompt);
            return;
        }
        void run(
            async () => {
                setContract(
                    await contracts.sign(token, {
                        typed_name: typedName.trim() || null,
                        signature_image_id: imageId,
                    }),
                );
            },
            { errorMessage: strings.bookingForms.signError },
        );
    };

    const uploadImage = (file: Blob, name: string): void => {
        void run(
            async () => {
                setImageId(await contracts.upload(token, file));
                setImageName(name);
            },
            { errorMessage: strings.bookingForms.signatureUploadError },
        );
    };

    const decline = (): void => {
        void run(
            async () => {
                setContract(await contracts.decline(token));
            },
            { errorMessage: strings.bookingForms.recordError },
        );
    };

    return {
        status,
        contract,
        typedName,
        setTypedName,
        imageName,
        uploadImage,
        sign,
        decline,
        busy,
        error,
        setError,
    };
}
