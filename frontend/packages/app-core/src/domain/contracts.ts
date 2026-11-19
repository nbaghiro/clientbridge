import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { formatDate, formatDateTime, parseTimestamp } from "../datetime";
import { type Load, useAsyncAction } from "../hooks";
import type { ContractSignature, Intent, SignatureStrokes, TimelineEntry } from "../ui";
import { useReplicaLoad } from "./sync";
import { afterReview, outgoing } from "./previews";
import { useBusinessName } from "./business";
import { strings } from "../strings";
import { type ApiLike, type Attempt, attemptKey, newIdempotencyKey } from "../api";

export const CONTRACT_LIBRARY_SQL = `
SELECT id, name, body, version, active, updated_at
FROM contracts ORDER BY active DESC, name COLLATE NOCASE`;

export const SIGNATURES_SQL = `
SELECT s.id, s.contract_id, s.client_id, c.name AS client_name, s.status, s.token,
       s.created_at AS sent_at, s.opened_at, s.signed_at, s.ip AS signer_ip, s.method,
       s.signer_name AS typed_name, s.strokes, s.contract_version, s.signed_body, s.declined_at
FROM signatures s LEFT JOIN clients c ON c.id = s.client_id
ORDER BY s.created_at DESC`;

interface LibraryRow {
    id: string;
    name: string;
    body: string;
    version: number;
    active: number;
    updated_at: string | null;
}

interface SignatureRow {
    id: string;
    contract_id: string;
    client_id: string;
    client_name: string | null;
    status: string;
    token: string | null;
    sent_at: string;
    opened_at: string | null;
    signed_at: string | null;
    signer_ip: string | null;
    method: string | null;
    typed_name: string | null;
    strokes: string | null;
    contract_version: number | null;
    signed_body: string | null;
    declined_at: string | null;
}

export interface SignatureRequest extends SignatureRow {
    contract_name: string;
    version: number;
    // Sent but not yet opened, opened, or a final state.
    state: "pending" | "opened" | "signed" | "declined" | "expired";
}

export interface ContractSummary {
    contract: LibraryRow;
    requests: SignatureRequest[];
    signed: number;
    waiting: number;
}

const p = strings.contracts;

function stateOf(row: SignatureRow): SignatureRequest["state"] {
    if (row.status === "pending") return row.opened_at === null ? "pending" : "opened";
    return row.status === "signed" || row.status === "declined" ? row.status : "expired";
}

export function useContractLibrary(): {
    load: Load;
    contracts: ContractSummary[];
    issuer: string;
} {
    const issuer = useBusinessName();
    const contracts = useQuery<LibraryRow>(CONTRACT_LIBRARY_SQL);
    const signatures = useQuery<SignatureRow>(SIGNATURES_SQL);
    const load = useReplicaLoad([contracts, signatures], contracts.data.length === 0);
    const list = useMemo(
        () =>
            contracts.data.map((contract) => {
                const requests = signatures.data
                    .filter((r) => r.contract_id === contract.id)
                    .map((r) => ({
                        ...r,
                        contract_name: contract.name,
                        version: r.contract_version ?? contract.version,
                        state: stateOf(r),
                    }));
                return {
                    contract,
                    requests,
                    signed: requests.filter((r) => r.state === "signed").length,
                    waiting: requests.filter((r) => r.state === "pending" || r.state === "opened")
                        .length,
                };
            }),
        [contracts.data, signatures.data],
    );
    return { load, contracts: list, issuer };
}

export function signatureIntent(state: SignatureRequest["state"]): Intent {
    switch (state) {
        case "signed":
            return "success";
        case "declined":
            return "danger";
        case "expired":
            return "neutral";
        case "opened":
            return "accent";
        default:
            return "warning";
    }
}

const stamp = (value: string, zone: string): string => formatDateTime(parseTimestamp(value), zone);

export function signatureActivity(r: SignatureRequest, zone: string): string {
    const at = (r.state === "declined" ? r.declined_at : r.signed_at) ?? r.opened_at ?? r.sent_at;
    return p.activity[r.state](formatDate(parseTimestamp(at), zone));
}

/** The text a client agreed to once signed, otherwise the contract's current text. */
export function signedText(r: SignatureRequest, current: string): string {
    return r.signed_body ?? current;
}

function parseStrokes(raw: string | null): SignatureStrokes | null {
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.map((stroke: unknown) =>
            Array.isArray(stroke)
                ? stroke
                      .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2)
                      .map(([x, y]) => [x, y] as const)
                : [],
        );
    } catch {
        return null;
    }
}

/** The signature block printed under a signed copy. */
export function signatureBlock(r: SignatureRequest, zone: string): ContractSignature | null {
    if (r.state !== "signed" || r.signed_at === null) return null;
    return {
        heading: p.signatureHeading,
        name: r.typed_name ?? r.client_name ?? "",
        strokes: r.method === "drawn" ? parseStrokes(r.strokes) : null,
        facts: [
            { label: p.facts.signedAt, value: stamp(r.signed_at, zone) },
            { label: p.facts.ip, value: r.signer_ip ?? "" },
            { label: p.facts.method, value: r.method === null ? "" : (p.method[r.method] ?? "") },
            { label: p.facts.version, value: p.version(r.version) },
            { label: p.facts.reference, value: r.id.toUpperCase() },
        ],
    };
}

/** A signed copy as plain text, for sharing from the phone where printing isn't available. */
export function signedCopyText(
    r: SignatureRequest,
    current: string,
    issuer: string,
    zone: string,
): string {
    const block = signatureBlock(r, zone);
    return [
        issuer,
        r.contract_name,
        p.version(r.version),
        "",
        signedText(r, current),
        ...(block === null
            ? []
            : [
                  "",
                  block.heading,
                  block.name,
                  ...block.facts.map((f) => strings.common.labelColonValue(f.label, f.value)),
              ]),
    ].join("\n");
}

/** Names the copy after its contract and signer; browsers save a printed PDF under this title. */
export function signedCopyTitle(r: SignatureRequest): string {
    return p.signedCopyTitle(r.contract_name, r.typed_name ?? r.client_name ?? "");
}

export function signedCopyFile(r: SignatureRequest): string {
    return `${signedCopyTitle(r).replace(/[\\/:*?"<>|]+/g, "-")}.txt`;
}

/** What happened to one request, oldest first. */
export function signatureHistory(r: SignatureRequest, zone: string): TimelineEntry[] {
    const out: TimelineEntry[] = [
        { key: "sent", label: p.event.sent, at: stamp(r.sent_at, zone), intent: "neutral" },
    ];
    if (r.opened_at !== null)
        out.push({
            key: "opened",
            label: p.event.opened,
            at: stamp(r.opened_at, zone),
            intent: "accent",
        });
    if (r.state === "signed" && r.signed_at !== null)
        out.push({
            key: "signed",
            label: p.event.signed,
            at: stamp(r.signed_at, zone),
            detail: r.signer_ip === null ? undefined : p.eventIp(r.signer_ip),
            intent: "success",
        });
    if (r.state === "declined")
        out.push({
            key: "declined",
            label: p.event.declined,
            at: stamp(r.declined_at ?? r.opened_at ?? r.sent_at, zone),
            intent: "danger",
        });
    return out;
}

function signingLink(base: string, token: string): string {
    return `${base}/contract/${token}`;
}

interface ContractDraft {
    body: string;
    setBody: (v: string) => void;
    changed: boolean;
    nextVersion: number;
    busy: boolean;
    failed: boolean;
    publish: () => void;
}

/** Publishing new text makes a new version; clients who signed earlier keep the text they signed. */
export function useContractDraft(
    api: ApiLike,
    contract: { id: string; body: string; version: number },
    onPublished: () => void,
): ContractDraft {
    const [body, setBody] = useState(contract.body);
    const attempt = useRef<Attempt | null>(null);
    const action = useAsyncAction();
    return {
        body,
        setBody,
        changed: body.trim() !== contract.body.trim() && body.trim() !== "",
        nextVersion: contract.version + 1,
        busy: action.busy,
        failed: action.error !== null,
        // a retry of an attempt whose answer was lost replays it instead of meeting "unchanged"
        publish: () => {
            const idempotencyKey = attemptKey(attempt, { id: contract.id, body });
            action.run(
                async () => {
                    await api.post(
                        `/v1/contracts/${contract.id}/versions`,
                        { body },
                        { idempotencyKey },
                    );
                    attempt.current = null;
                },
                { onSuccess: onPublished },
            );
        },
    };
}

interface NewContract {
    name: string;
    setName: (v: string) => void;
    body: string;
    setBody: (v: string) => void;
    busy: boolean;
    problem: "name-missing" | "body-missing" | "failed" | null;
    create: () => void;
}

/** A new contract starts at version 1. */
export function useNewContract(api: ApiLike, onCreated: (id: string) => void): NewContract {
    const [name, setNameRaw] = useState("");
    const [body, setBodyRaw] = useState("");
    const [problem, setProblem] = useState<"name-missing" | "body-missing" | null>(null);
    const attempt = useRef<Attempt | null>(null);
    const action = useAsyncAction();
    return {
        name,
        setName: (v) => {
            setProblem(null);
            setNameRaw(v);
        },
        body,
        setBody: (v) => {
            setProblem(null);
            setBodyRaw(v);
        },
        busy: action.busy,
        problem: problem ?? (action.error === null ? null : "failed"),
        create: () => {
            if (name.trim() === "") {
                setProblem("name-missing");
                return;
            }
            if (body.trim() === "") {
                setProblem("body-missing");
                return;
            }
            const request = { name: name.trim(), body: body.trim() };
            const idempotencyKey = attemptKey(attempt, request);
            action.run(async () => {
                const out = await api.post<{ id: string }>("/v1/contracts", request, {
                    idempotencyKey,
                });
                attempt.current = null;
                onCreated(out.id);
            });
        },
    };
}

interface SignatureActions {
    copiedId: string | null;
    copy: (r: SignatureRequest) => void;
    resent: Set<string>;
    resend: (r: SignatureRequest) => void;
    busyId: string | null;
    error: string | null;
}

/** `copyText` is the platform clipboard; the link goes to the Connect host. */
export function useSignatureActions(
    api: ApiLike,
    linkBase: string,
    copyText: (text: string) => void,
): SignatureActions {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [resent, setResent] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);
    // one key per request, so retrying one row after resending another still replays its own send
    const keys = useRef(new Map<string, string>());
    const { error, run } = useAsyncAction();
    return {
        copiedId,
        copy: (r) => {
            if (r.token === null) return;
            copyText(signingLink(linkBase, r.token));
            setCopiedId(r.id);
        },
        resent,
        resend: (r) => {
            afterReview(
                {
                    title: strings.previews.title,
                    confirmLabel: strings.previews.sendAgain,
                    load: outgoing.signatureResend(api, r.id),
                },
                () => {
                    setBusyId(r.id);
                    const idempotencyKey = keys.current.get(r.id) ?? newIdempotencyKey();
                    keys.current.set(r.id, idempotencyKey);
                    run(
                        async () => {
                            try {
                                await api.post(
                                    `/v1/signatures/${r.id}/resend`,
                                    {},
                                    { idempotencyKey },
                                );
                                keys.current.delete(r.id);
                            } finally {
                                setBusyId(null);
                            }
                        },
                        {
                            onSuccess: () => {
                                setResent((s) => new Set(s).add(r.id));
                            },
                            errorMessage: p.actionFailed,
                        },
                    );
                },
            );
        },
        busyId,
        error,
    };
}
