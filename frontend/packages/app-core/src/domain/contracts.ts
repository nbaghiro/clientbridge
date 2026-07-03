import { usePowerSync, useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { useBusinessId } from "../hooks/primitives";
import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { newIdempotencyKey, newRowId } from "../util/primitives";

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
        run(() => sendContract(api, { contract_id: contractId, client_id: clientId }), {
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
        run(
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
