import {
    type ContractRow,
    type DraftField,
    type FormRow,
    BUILDER_FIELD_TYPES,
    FIELD_TYPE_LABEL,
    activeContracts,
    activeForms,
    canManagePayments,
    hasOptions,
    signatureStatusIntent,
    useClients,
    useContractDraftForm,
    useContracts,
    useCurrentRole,
    useFormBuilder,
    useFormFields,
    useForms,
    useSendContractForm,
    useSendFormForm,
} from "@clientbridge/app-core";
import { useState } from "react";

import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function BookingForms() {
    const role = useCurrentRole(getTokens()?.access_token ?? null);

    if (!canManagePayments(role)) {
        return (
            <div className="max-w-3xl">
                <h1 className="font-display text-2xl font-bold text-ink">Booking & forms</h1>
                <p className="mt-1 text-sm text-muted">
                    Only owners and admins can manage forms and contracts.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-10">
            <div>
                <h1 className="font-display text-2xl font-bold text-ink">Booking & forms</h1>
                <p className="mt-1 text-sm text-muted">
                    Build intake forms and contracts, then send them to clients to complete.
                </p>
            </div>
            <FormsSection />
            <ContractsSection />
        </div>
    );
}

// ── Forms ─────────────────────────────────────────────────────────────────────────────────────────

function FormsSection() {
    const forms = useForms();
    const [mode, setMode] = useState<"none" | "send" | "create">("none");

    return (
        <section>
            <SectionHead
                title="Intake forms"
                onCreate={() => {
                    setMode((m) => (m === "create" ? "none" : "create"));
                }}
                onSend={() => {
                    setMode((m) => (m === "send" ? "none" : "send"));
                }}
                createLabel="New form"
                sendLabel="Send form"
                canSend={forms.length > 0}
            />

            {mode === "send" ? (
                <SendForm
                    forms={activeForms(forms)}
                    onDone={() => {
                        setMode("none");
                    }}
                />
            ) : null}
            {mode === "create" ? (
                <FormBuilderPanel
                    onDone={() => {
                        setMode("none");
                    }}
                />
            ) : null}

            <div className="mt-4 space-y-2">
                {forms.length === 0 ? (
                    <Empty>No forms yet. Create one to send to clients.</Empty>
                ) : (
                    forms.map((f) => <FormRowItem key={f.id} form={f} />)
                )}
            </div>
        </section>
    );
}

function FormRowItem({ form }: { form: FormRow }) {
    const fields = useFormFields(form.id);
    return (
        <ListRow>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{form.name}</p>
                <p className="text-xs text-muted">
                    {fields.length} field{fields.length === 1 ? "" : "s"}
                    {form.require_signature === 1 ? " · signature required" : ""}
                </p>
            </div>
            {form.active === 1 ? (
                <StatusPill status="active" intent="success" />
            ) : (
                <StatusPill status="inactive" intent="neutral" />
            )}
        </ListRow>
    );
}

function SendForm({ forms, onDone }: { forms: FormRow[]; onDone: () => void }) {
    const send = useSendFormForm(api, onDone);
    const clients = useClients();

    return (
        <Panel title="Send a form">
            <PickerRow label="Form">
                <select
                    value={send.formId}
                    onChange={(e) => {
                        send.setFormId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">Select a form</option>
                    {forms.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            <PickerRow label="Client">
                <select
                    value={send.clientId}
                    onChange={(e) => {
                        send.setClientId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">Select a client</option>
                    {clients.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                            {cl.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            {send.error !== null ? <p className="text-sm text-danger">{send.error}</p> : null}
            <PanelActions
                onCancel={onDone}
                busy={send.busy}
                onSubmit={send.submit}
                label="Send form"
            />
        </Panel>
    );
}

function FormBuilderPanel({ onDone }: { onDone: () => void }) {
    const builder = useFormBuilder(onDone);

    return (
        <Panel title="New form">
            <PickerRow label="Form name">
                <input
                    value={builder.name}
                    onChange={(e) => {
                        builder.setName(e.target.value);
                    }}
                    placeholder="New client intake"
                    className={field}
                />
            </PickerRow>

            <div className="space-y-3">
                {builder.fields.map((f, i) => (
                    <FieldEditor
                        key={f.key}
                        field={f}
                        index={i}
                        onChange={(patch) => {
                            builder.updateField(f.key, patch);
                        }}
                        onRemove={
                            builder.fields.length > 1
                                ? () => {
                                      builder.removeField(f.key);
                                  }
                                : undefined
                        }
                    />
                ))}
            </div>

            <button
                type="button"
                onClick={builder.addField}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-bg"
            >
                + Add field
            </button>

            <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                    type="checkbox"
                    checked={builder.requireSignature}
                    onChange={(e) => {
                        builder.setRequireSignature(e.target.checked);
                    }}
                    className="h-4 w-4"
                />
                Require a signature
            </label>

            {builder.error !== null ? <p className="text-sm text-danger">{builder.error}</p> : null}
            <PanelActions
                onCancel={onDone}
                busy={builder.busy}
                onSubmit={builder.submit}
                label="Create form"
            />
        </Panel>
    );
}

function FieldEditor({
    field: f,
    index,
    onChange,
    onRemove,
}: {
    field: DraftField;
    index: number;
    onChange: (patch: Partial<Omit<DraftField, "key">>) => void;
    onRemove?: (() => void) | undefined;
}) {
    return (
        <div className="rounded-md border border-line bg-bg p-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Field {index + 1}
                </span>
                {onRemove !== undefined ? (
                    <button
                        type="button"
                        onClick={onRemove}
                        className="text-xs font-medium text-danger hover:underline"
                    >
                        Remove
                    </button>
                ) : null}
            </div>
            <div className="mt-2 flex gap-2">
                <input
                    value={f.label}
                    onChange={(e) => {
                        onChange({ label: e.target.value });
                    }}
                    placeholder="Field label"
                    className={`${field} flex-1`}
                />
                <select
                    value={f.type}
                    onChange={(e) => {
                        onChange({ type: e.target.value });
                    }}
                    className={`${field} w-40`}
                >
                    {BUILDER_FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                            {FIELD_TYPE_LABEL[t] ?? t}
                        </option>
                    ))}
                </select>
            </div>
            {hasOptions(f.type) ? (
                <input
                    value={f.options}
                    onChange={(e) => {
                        onChange({ options: e.target.value });
                    }}
                    placeholder="Options, comma separated"
                    className={`${field} mt-2`}
                />
            ) : null}
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => {
                        onChange({ required: e.target.checked });
                    }}
                    className="h-3.5 w-3.5"
                />
                Required
            </label>
        </div>
    );
}

// ── Contracts ──────────────────────────────────────────────────────────────────────────────────────

function ContractsSection() {
    const contracts = useContracts();
    const [mode, setMode] = useState<"none" | "send" | "create">("none");

    return (
        <section>
            <SectionHead
                title="Contracts"
                onCreate={() => {
                    setMode((m) => (m === "create" ? "none" : "create"));
                }}
                onSend={() => {
                    setMode((m) => (m === "send" ? "none" : "send"));
                }}
                createLabel="New contract"
                sendLabel="Send for signature"
                canSend={contracts.length > 0}
            />

            {mode === "send" ? (
                <SendContract
                    contracts={activeContracts(contracts)}
                    onDone={() => {
                        setMode("none");
                    }}
                />
            ) : null}
            {mode === "create" ? (
                <ContractDraftPanel
                    onDone={() => {
                        setMode("none");
                    }}
                />
            ) : null}

            <div className="mt-4 space-y-2">
                {contracts.length === 0 ? (
                    <Empty>No contracts yet. Create one to send for signature.</Empty>
                ) : (
                    contracts.map((cnt) => <ContractRowItem key={cnt.id} contract={cnt} />)
                )}
            </div>
        </section>
    );
}

function ContractRowItem({ contract }: { contract: ContractRow }) {
    return (
        <ListRow>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{contract.name}</p>
                <p className="text-xs text-muted">Version {contract.version}</p>
            </div>
            {contract.active === 1 ? (
                <StatusPill status="active" intent="success" />
            ) : (
                <StatusPill status="inactive" intent="neutral" />
            )}
        </ListRow>
    );
}

function SendContract({ contracts, onDone }: { contracts: ContractRow[]; onDone: () => void }) {
    const send = useSendContractForm(api, onDone);
    const clients = useClients();

    return (
        <Panel title="Send for signature">
            <PickerRow label="Contract">
                <select
                    value={send.contractId}
                    onChange={(e) => {
                        send.setContractId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">Select a contract</option>
                    {contracts.map((cnt) => (
                        <option key={cnt.id} value={cnt.id}>
                            {cnt.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            <PickerRow label="Client">
                <select
                    value={send.clientId}
                    onChange={(e) => {
                        send.setClientId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">Select a client</option>
                    {clients.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                            {cl.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            {send.error !== null ? <p className="text-sm text-danger">{send.error}</p> : null}
            <PanelActions onCancel={onDone} busy={send.busy} onSubmit={send.submit} label="Send" />
            <p className="text-xs text-muted">
                The client signs on a secure link. Status appears here once they respond.{" "}
                <SignatureStatusLegend />
            </p>
        </Panel>
    );
}

function SignatureStatusLegend() {
    return (
        <span className="inline-flex gap-1 align-middle">
            {["pending", "signed", "declined"].map((s) => (
                <StatusPill key={s} status={s} intent={signatureStatusIntent(s)} />
            ))}
        </span>
    );
}

function ContractDraftPanel({ onDone }: { onDone: () => void }) {
    const draft = useContractDraftForm(onDone);

    return (
        <Panel title="New contract">
            <PickerRow label="Name">
                <input
                    value={draft.name}
                    onChange={(e) => {
                        draft.setName(e.target.value);
                    }}
                    placeholder="Service agreement"
                    className={field}
                />
            </PickerRow>
            <PickerRow label="Contract text">
                <textarea
                    value={draft.body}
                    onChange={(e) => {
                        draft.setBody(e.target.value);
                    }}
                    rows={8}
                    placeholder="Paste or write the contract the client will sign…"
                    className={`${field} resize-y`}
                />
            </PickerRow>
            {draft.error !== null ? <p className="text-sm text-danger">{draft.error}</p> : null}
            <PanelActions
                onCancel={onDone}
                busy={draft.busy}
                onSubmit={draft.submit}
                label="Create contract"
            />
        </Panel>
    );
}

// ── Shared bits ────────────────────────────────────────────────────────────────────────────────────

function SectionHead({
    title,
    onCreate,
    onSend,
    createLabel,
    sendLabel,
    canSend,
}: {
    title: string;
    onCreate: () => void;
    onSend: () => void;
    createLabel: string;
    sendLabel: string;
    canSend: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
            <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
            <div className="flex gap-2">
                {canSend ? (
                    <button
                        type="button"
                        onClick={onSend}
                        className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                    >
                        {sendLabel}
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={onCreate}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {createLabel}
                </button>
            </div>
        </div>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-5 shadow-card">
            <h3 className="font-display text-base font-bold text-ink">{title}</h3>
            {children}
        </section>
    );
}

function PickerRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
            {label}
            {children}
        </label>
    );
}

function PanelActions({
    onCancel,
    onSubmit,
    busy,
    label,
}: {
    onCancel: () => void;
    onSubmit: () => void;
    busy: boolean;
    label: string;
}) {
    return (
        <div className="flex justify-end gap-2">
            <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={onSubmit}
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
                {busy ? "Working…" : label}
            </button>
        </div>
    );
}

function ListRow({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
            {children}
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
