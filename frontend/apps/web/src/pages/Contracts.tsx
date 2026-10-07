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
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Button,
    Choice,
    ContractDocument,
    Empty,
    IconButton,
    Modal,
    Notice,
    Panel,
    StatusPill,
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
            <div className="flex items-center justify-between gap-4 pb-5">
                <p className="text-sm text-muted">{s.subtitle}</p>
                <Button variant="outline" icon="plus" onPress={add}>
                    {s.newContract}
                </Button>
            </div>
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
                    <>
                        <Choice
                            layout="cards"
                            label={s.templates}
                            value={active.contract.id}
                            onChange={setPicked}
                            options={library.contracts.map((x) => ({
                                key: x.contract.id,
                                label: x.contract.name,
                                hint: [
                                    s.versionShort(x.contract.version),
                                    s.signedCount(x.signed),
                                    s.waitingCount(x.waiting),
                                ].join(" · "),
                            }))}
                        />
                        <ContractDetail
                            key={`${active.contract.id}:${String(active.contract.version)}`}
                            summary={active}
                            issuer={library.issuer}
                            onSend={() => {
                                setSending(true);
                            }}
                        />
                    </>
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
    const [editing, setEditing] = useState(false);
    const [viewing, setViewing] = useState<SignatureRequest | null>(null);
    const draft = useContractDraft(api, summary.contract, () => {
        setEditing(false);
    });
    const actions = useSignatureActions(api, config.bookUrl, copyText);
    const c = summary.contract;
    const updated =
        c.updated_at === null ? "" : ` · ${s.updated(formatDate(parseTimestamp(c.updated_at)))}`;

    return (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <section className="min-w-0">
                <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.text}
                    </h2>
                    {editing ? null : (
                        <Button
                            variant="link"
                            size="sm"
                            icon="edit"
                            onPress={() => {
                                setEditing(true);
                            }}
                        >
                            {s.editText}
                        </Button>
                    )}
                </div>
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
                        {draft.failed ? <Notice tone="danger">{s.publishError}</Notice> : null}
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
                                {draft.busy ? s.publishing : s.publish(draft.nextVersion)}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="max-h-[38rem] overflow-y-auto rounded-md">
                        <ContractDocument
                            density="compact"
                            issuer={issuer}
                            title={c.name}
                            meta={`${s.version(c.version)}${updated}`}
                            clauses={contractClauses(c.body)}
                        />
                    </div>
                )}
            </section>
            <section className="min-w-0">
                <Panel
                    flush
                    title={s.signatures}
                    subtitle={`${s.signedCount(summary.signed)} · ${s.waitingCount(summary.waiting)}`}
                    actions={
                        <Button size="sm" icon="send" onPress={onSend}>
                            {s.send}
                        </Button>
                    }
                >
                    {summary.requests.length === 0 ? <Empty message={s.noSignatures} /> : null}
                    <ul className="divide-y divide-line-soft">
                        {summary.requests.map((r) => {
                            const waiting = r.state === "pending" || r.state === "opened";
                            const name = r.client_name ?? "";
                            return (
                                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
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
                                            {signatureActivity(r)}
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
                                            status={s.status[r.state] ?? r.state}
                                            intent={signatureIntent(r.state)}
                                            asWritten
                                        />
                                    )}
                                    {waiting ? (
                                        <div className="flex gap-0.5">
                                            <IconButton
                                                icon={actions.copiedId === r.id ? "check" : "copy"}
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
                                                icon={actions.resent.has(r.id) ? "check" : "send"}
                                                label={
                                                    actions.resent.has(r.id) ? s.resent : s.resend
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
                </Panel>
            </section>
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
    return (
        <Modal open onClose={onClose} size="lg">
            <div className="space-y-5">
                <ContractDocument
                    issuer={issuer}
                    title={request.contract_name}
                    meta={s.version(request.version)}
                    clauses={contractClauses(signedText(request, currentBody))}
                    signature={signatureBlock(request)}
                />
                <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.history}
                    </h3>
                    <ActivityTimeline entries={signatureHistory(request)} />
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
