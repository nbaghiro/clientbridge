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
    usePeoplePhotos,
    useSignatureActions,
    formatParts,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    ActivityTimeline,
    Avatar,
    Badge,
    Button,
    ContractDocument,
    Empty,
    IconButton,
    ListPage,
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

const GRID = "grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4";

export function Contracts() {
    const zone = useBusinessZone();
    const library = useContractLibrary();
    const [picked, setPicked] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [sending, setSending] = useState(false);
    const active = library.contracts.find((x) => x.contract.id === picked) ?? null;
    const none = library.load.hasData && library.contracts.length === 0;
    const add = (): void => {
        setAdding(true);
    };

    return (
        <div>
            {active !== null ? (
                <Modal
                    variant="drawer"
                    size="xl"
                    onClose={() => {
                        setPicked(null);
                    }}
                >
                    <ContractDetail
                        key={`${active.contract.id}:${String(active.contract.version)}`}
                        summary={active}
                        issuer={library.issuer}
                        onSend={() => {
                            setSending(true);
                        }}
                    />
                </Modal>
            ) : null}
            <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-muted">{s.subtitle}</p>
                    {none ? null : (
                        <Button size="sm" icon="plus" onPress={add}>
                            {s.newContract}
                        </Button>
                    )}
                </div>
                <Loaded load={library.load} loading={s.loading} failed={s.loadError}>
                    <ListPage
                        head={
                            none ? undefined : (
                                <div className={GRID}>
                                    <span>{s.colContract}</span>
                                    <span>{s.signatures}</span>
                                    <span className="text-right">{s.colUpdated}</span>
                                </div>
                            )
                        }
                        rows={library.contracts}
                        rowKey={(x) => x.contract.id}
                        onRowPress={(x) => {
                            setPicked(x.contract.id);
                        }}
                        empty={{
                            message: s.noContractsTitle,
                            body: s.noContractsBody,
                            icon: "note",
                            actions: (
                                <Button size="sm" icon="plus" onPress={add}>
                                    {s.newContract}
                                </Button>
                            ),
                        }}
                        renderRow={(x) => (
                            <div className={GRID}>
                                <div className="min-w-0">
                                    <div className="truncate font-medium text-ink">
                                        {x.contract.name}
                                    </div>
                                    <div className="text-xs text-muted">
                                        {s.versionShort(x.contract.version)}
                                    </div>
                                </div>
                                <div className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
                                    <span className="truncate">{s.signedCount(x.signed)}</span>
                                    {x.waiting > 0 ? (
                                        <Badge label={s.waitingCount(x.waiting)} intent="warning" />
                                    ) : null}
                                </div>
                                <div className="text-right text-sm text-ink-soft">
                                    {x.contract.updated_at === null
                                        ? "—"
                                        : formatDate(parseTimestamp(x.contract.updated_at), zone)}
                                </div>
                            </div>
                        )}
                    />
                </Loaded>
            </div>
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
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const [editing, setEditing] = useState(false);
    const [viewing, setViewing] = useState<SignatureRequest | null>(null);
    const draft = useContractDraft(api, summary.contract, () => {
        setEditing(false);
    });
    const actions = useSignatureActions(api, config.bookUrl, copyText);
    const c = summary.contract;
    const updated =
        c.updated_at === null ? null : s.updated(formatDate(parseTimestamp(c.updated_at), zone));

    return (
        <div>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="min-w-40 flex-1">
                    <h2 className="truncate font-display text-xl font-bold text-ink">{c.name}</h2>
                    <p className="truncate text-xs text-muted">
                        {formatParts([
                            s.version(c.version),
                            updated,
                            s.signedCount(summary.signed),
                            s.waitingCount(summary.waiting),
                        ])}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {!editing ? (
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
            <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                    {editing ? (
                        <Panel>
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
                        </Panel>
                    ) : (
                        <div className="overflow-hidden rounded-lg shadow-card">
                            <ContractDocument
                                density="compact"
                                issuer={issuer}
                                title={c.name}
                                meta={formatParts([s.version(c.version), updated])}
                                clauses={contractClauses(c.body)}
                            />
                        </div>
                    )}
                </div>
                <aside className="lg:sticky lg:top-0">
                    <Panel flush title={s.signatures}>
                        {summary.requests.length === 0 ? <Empty message={s.noSignatures} /> : null}
                        <ul className="divide-y divide-line-soft">
                            {summary.requests.map((r) => {
                                const waiting = r.state === "pending" || r.state === "opened";
                                const name = r.client_name ?? "";
                                return (
                                    <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                                        <Avatar
                                            name={name}
                                            src={photos.client(r.client_id)}
                                            size="sm"
                                        />
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
                                                        actions.copiedId === r.id ? "check" : "copy"
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
                                                        actions.resent.has(r.id) ? "check" : "send"
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
                    </Panel>
                </aside>
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
        <Modal variant="drawer" open onClose={onClose} size="lg">
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
