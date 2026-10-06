import { useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { type PublicBrand, usePublicResource } from "./publicResource";

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

export interface PublicContract {
    contract_name: string;
    business_name: string;
    brand: PublicBrand;
    body: string;
    signer_name: string | null;
    status: string;
}

interface SignInput {
    typed_name?: string | null;
    signature_image_id?: string | null;
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
    upload(token: string, file: Blob): Promise<string>; // returns a file_id to pass as signature_image_id
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
                    strings.publicContract.signatureUploadFailedDetail,
                );
            return meta.file_id;
        },
    };
}

type PublicContractStatus = "loading" | "not-found" | "error" | "resolved" | "pending";

interface PublicContractSign {
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

/** The file input stays per platform and hands its Blob to `uploadImage`. */
export function usePublicContractSign(
    contracts: PublicContractClient,
    token: string,
): PublicContractSign {
    const {
        status: load,
        data: contract,
        setData: setContract,
    } = usePublicResource(contracts.getContract, token);
    const [typedName, setTypedName] = useState("");
    const [imageId, setImageId] = useState<string | null>(null);
    const [imageName, setImageName] = useState("");
    const seededName = useRef(false);
    const { busy, error, setError, run } = useAsyncAction();

    // Seed the typed-name field once from the loaded contract's known signer (not on later updates).
    useEffect(() => {
        if (!seededName.current && contract?.signer_name != null) {
            seededName.current = true;
            setTypedName(contract.signer_name);
        }
    }, [contract]);

    const status: PublicContractStatus =
        load !== "ready" ? load : contract?.status !== "pending" ? "resolved" : "pending";

    const sign = (): void => {
        if (typedName.trim().length === 0 && imageId === null) {
            setError(strings.publicContract.signPrompt);
            return;
        }
        run(
            async () => {
                setContract(
                    await contracts.sign(token, {
                        typed_name: typedName.trim() || null,
                        signature_image_id: imageId,
                    }),
                );
            },
            { errorMessage: strings.publicContract.signError },
        );
    };

    const uploadImage = (file: Blob, name: string): void => {
        run(
            async () => {
                setImageId(await contracts.upload(token, file));
                setImageName(name);
            },
            { errorMessage: strings.publicContract.signatureUploadError },
        );
    };

    const decline = (): void => {
        run(
            async () => {
                setContract(await contracts.decline(token));
            },
            { errorMessage: strings.publicContract.recordError },
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
