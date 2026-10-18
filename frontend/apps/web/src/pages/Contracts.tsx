import {
    type ContractSummary,
    type SignatureRequest,
    contractClauses,
    formatDate,
    parseTimestamp,
    signatureActivity,
    signatureBlock,
    signatureHistory,
    signatureIntent,
    signedText,
    strings,
    useContractDraft,
    useContractLibrary,
    useNewContract,
    useSignatureActions,
    formatParts,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Button,
    ContractDocument,
    Empty,
    IconButton,
    ListRow,
    Modal,
    Notice,
    StatusPill,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";

import { Loaded } from "../components/Loaded";
import { SendToClientDialog } from "../components/SendToClient";
import { config } from "../config";
import { api } from "../lib/api";

const s = strings.contracts;

const copyText = (text: string): void => {
    navigator.clipboard.writeText(text).catch(() => undefined);
};

export function Contracts() {
    const library = useContractLibrary();
    const [picked, setPicked] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [sending, setSending] = useState(false);
    const active =
        library.contracts.find((x) => x.contract.id === picked) ?? library.contracts[0] ?? null;
    const add = (): void => {
        setAdding(true);
    };

    return (
        <div>
            <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                {active === null ? (
                    <Empty
                        variant="card"
                        icon="note"
                        message={s.noContractsTitle}
                        body={s.noContractsBody}
                        actions={<Button onPress={add}>{s.newContract}</Button>}
                    />
                ) : (
                    <div className="flex h-[calc(100vh-12rem)] min-h-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line">
                            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                                <h2 className="text-sm font-semibold text-ink">{s.templates}</h2>
                                <Button size="sm" variant="quiet" icon="plus" onPress={add}>
                                    {s.newContract}
                                </Button>
                            </div>
                            <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto">
                                {library.contracts.map((x) => (
                                    <li key={x.contract.id}>
                                        <ListRow
                                            title={x.contract.name}
                                            selected={x.contract.id === active.contract.id}
                                            onPress={() => {
                                                setPicked(x.contract.id);
                                            }}
                                            detail={formatParts([
                                                s.versionShort(x.contract.version),
                                                s.signedCount(x.signed),
                                                s.waitingCount(x.waiting),
                                            ])}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </aside>
                        <ContractDetail
                            key={`${active.contract.id}:${String(active.contract.version)}`}
                            summary={active}
                            issuer={library.issuer}
                            onSend={() => {
                                setSending(true);
                            }}
                        />
                    </div>
                )}
            </Loaded>
            {adding ? (
                <NewContractDialog
                    onClose={() => {
                        setAdding(false);
                    }}
                    onCreated={(id) => {
                        setPicked(id);
                        setAdding(false);
                    }}
                />
            ) : null}
            {sending && active !== null ? (
                <SendToClientDialog
                    title={s.sendTitle(active.contract.name)}
                    path="/v1/contracts/send"
                    body={{ contract_id: active.contract.id }}
                    onClose={() => {
                        setSending(false);
                    }}
                />
            ) : null}
        </div>
    );
}

function ContractDetail({
    summary,
    issuer,
    onSend,
}: {
    summary: ContractSummary;
    issuer: string;
    onSend: () => void;
}) {
    const zone = useBusinessZone();
    const [editing, setEditing] = useState(false);
    const [view, setView] = useState<"text" | "signatures">("text");
    const [viewing, setViewing] = useState<SignatureRequest | null>(null);
    const draft = useContractDraft(api, summary.contract, () => {
        setEditing(false);
    });
    const actions = useSignatureActions(api, config.bookUrl, copyText);
    const c = summary.contract;
    const updated =
        c.updated_at === null ? null : s.updated(formatDate(parseTimestamp(c.updated_at), zone));

    return (
        <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-lg font-bold text-ink">{c.name}</h2>
                    <p className="truncate text-xs text-muted">
                        {formatParts([
                            s.version(c.version),
                            updated,
                            s.signedCount(summary.signed),
                            s.waitingCount(summary.waiting),
                        ])}
                    </p>
                </div>
                <Tabs
                    variant="pill"
                    label={c.name}
                    items={[
                        { key: "text", label: s.text },
                        { key: "signatures", label: s.signatures },
                    ]}
                    active={view}
                    onSelect={setView}
                />
                <div className="flex items-center gap-2">
                    {view === "text" && !editing ? (
                        <Button
                            size="sm"
                            variant="outline"
                            icon="edit"
                            onPress={() => {
                                setEditing(true);
                            }}
                        >
                            {s.editText}
                        </Button>
                    ) : null}
                    <Button size="sm" icon="send" onPress={onSend}>
                        {s.send}
                    </Button>
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-bg/40">
                <div className="mx-auto max-w-3xl px-6 py-6">
                    {view === "text" ? (
                        <>
                            {editing ? (
                                <div className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-card">
                                    <TextField
                                        label={s.text}
                                        multiline
                                        rows={16}
                                        value={draft.body}
                                        onChange={draft.setBody}
                                        surface="surface"
                                    />
                                    <Notice tone="info" banner>
                                        {s.versionNotice(draft.nextVersion)}
                                    </Notice>
                                    {draft.failed ? (
                                        <Notice tone="danger">{s.publishError}</Notice>
                                    ) : null}
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="quiet"
                                            onPress={() => {
                                                setEditing(false);
                                            }}
                                        >
                                            {s.cancel}
                                        </Button>
                                        <Button
                                            onPress={draft.publish}
                                            busy={draft.busy}
                                            disabled={!draft.changed}
                                        >
                                            {draft.busy
                                                ? s.publishing
                                                : s.publish(draft.nextVersion)}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="max-h-[38rem] overflow-y-auto rounded-md">
                                    <ContractDocument
                                        density="compact"
                                        issuer={issuer}
                                        title={c.name}
                                        meta={formatParts([s.version(c.version), updated])}
                                        clauses={contractClauses(c.body)}
                                    />
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-line bg-surface">
                            {summary.requests.length === 0 ? (
                                <Empty message={s.noSignatures} />
                            ) : null}
                            <ul className="divide-y divide-line-soft">
                                {summary.requests.map((r) => {
                                    const waiting = r.state === "pending" || r.state === "opened";
                                    const name = r.client_name ?? "";
                                    return (
                                        <li
                                            key={r.id}
                                            className="flex items-center gap-3 px-4 py-3"
                                        >
                                            <Avatar name={name} size="sm" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-medium text-ink">
                                                        {name}
                                                    </span>
                                                    {r.version !== c.version ? (
                                                        <span className="text-xs text-muted">
                                                            {s.versionShort(r.version)}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="truncate text-xs text-muted">
                                                    {signatureActivity(r, zone)}
                                                </div>
                                            </div>
                                            {r.state === "signed" ? (
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    icon="receipt"
                                                    onPress={() => {
                                                        setViewing(r);
                                                    }}
                                                >
                                                    {s.signedCopy}
                                                </Button>
                                            ) : (
                                                <StatusPill
                                                    status={s.status[r.state]}
                                                    intent={signatureIntent(r.state)}
                                                />
                                            )}
                                            {waiting ? (
                                                <div className="flex gap-0.5">
                                                    <IconButton
                                                        icon={
                                                            actions.copiedId === r.id
                                                                ? "check"
                                                                : "copy"
                                                        }
                                                        label={
                                                            actions.copiedId === r.id
                                                                ? s.copied
                                                                : s.copyLink
                                                        }
                                                        onPress={() => {
                                                            actions.copy(r);
                                                        }}
                                                    />
                                                    <IconButton
                                                        icon={
                                                            actions.resent.has(r.id)
                                                                ? "check"
                                                                : "send"
                                                        }
                                                        label={
                                                            actions.resent.has(r.id)
                                                                ? s.resent
                                                                : s.resend
                                                        }
                                                        disabled={
                                                            actions.busyId === r.id ||
                                                            actions.resent.has(r.id)
                                                        }
                                                        onPress={() => {
                                                            actions.resend(r);
                                                        }}
                                                    />
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                            {actions.error !== null ? (
                                <div className="px-4 pb-3">
                                    <Notice tone="danger">{actions.error}</Notice>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
            {viewing !== null ? (
                <SignedCopyDialog
                    request={viewing}
                    currentBody={c.body}
                    issuer={issuer}
                    onClose={() => {
                        setViewing(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function SignedCopyDialog({
    request,
    currentBody,
    issuer,
    onClose,
}: {
    request: SignatureRequest;
    currentBody: string;
    issuer: string;
    onClose: () => void;
}) {
    const zone = useBusinessZone();
    return (
        <Modal open onClose={onClose} size="lg">
            <div className="space-y-5">
                <ContractDocument
                    issuer={issuer}
                    title={request.contract_name}
                    meta={s.version(request.version)}
                    clauses={contractClauses(signedText(request, currentBody))}
                    signature={signatureBlock(request, zone)}
                />
                <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.history}
                    </h3>
                    <ActivityTimeline entries={signatureHistory(request, zone)} />
                </div>
                <p className="text-xs text-muted">{s.printNote}</p>
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {s.close}
                    </Button>
                    <Button
                        icon="printer"
                        onPress={() => {
                            globalThis.print();
                        }}
                    >
                        {s.print}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function NewContractDialog({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const draft = useNewContract(api, onCreated);
    return (
        <Modal open onClose={onClose} size="lg">
            <h2 className="font-display text-lg font-bold text-ink">{s.newTitle}</h2>
            <div className="mt-4 space-y-4">
                <TextField
                    label={s.nameLabel}
                    value={draft.name}
                    onChange={draft.setName}
                    placeholder={s.namePlaceholder}
                    error={draft.problem === "name-missing" ? s.newErrors["name-missing"] : null}
                />
                <TextField
                    label={s.text}
                    hint={s.newHint}
                    multiline
                    rows={10}
                    value={draft.body}
                    onChange={draft.setBody}
                    placeholder={s.bodyPlaceholder}
                    error={draft.problem === "body-missing" ? s.newErrors["body-missing"] : null}
                />
                {draft.problem === "failed" ? (
                    <Notice tone="danger">{s.newErrors.failed}</Notice>
                ) : null}
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button busy={draft.busy} onPress={draft.create}>
                        {draft.busy ? s.creating : s.create}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
