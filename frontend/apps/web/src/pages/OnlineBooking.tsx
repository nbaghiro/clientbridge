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
    strings,
    useClients,
    useContractDraftForm,
    useContracts,
    useFormBuilder,
    useFormFields,
    useForms,
    useSendContractForm,
    useSendFormForm,
} from "@clientbridge/app-core";
import { Empty, Panel, StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

export function OnlineBooking() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <div className="max-w-3xl">
                <p className="mt-1 text-sm text-muted">{strings.forms.ownerAdminOnly}</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-10">
            <div>
                <p className="mt-1 text-sm text-muted">{strings.forms.intro}</p>
            </div>
            <FormsSection />
            <ContractsSection />
        </div>
    );
}

function FormsSection() {
    const forms = useForms();
    const [mode, setMode] = useState<"none" | "send" | "create">("none");

    return (
        <section>
            <SectionHead
                title={strings.forms.intakeForms}
                onCreate={() => {
                    setMode((m) => (m === "create" ? "none" : "create"));
                }}
                onSend={() => {
                    setMode((m) => (m === "send" ? "none" : "send"));
                }}
                createLabel={strings.forms.newForm}
                sendLabel={strings.forms.sendForm}
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
                    <Empty message={strings.forms.emptyForms} />
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
                    {strings.forms.fieldCount(fields.length)}
                    {form.require_signature === 1 ? strings.forms.signatureRequired : ""}
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
        <Panel title={strings.forms.sendFormTitle}>
            <PickerRow label={strings.forms.form}>
                <select
                    value={send.formId}
                    onChange={(e) => {
                        send.setFormId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.forms.selectForm}</option>
                    {forms.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            <PickerRow label={strings.forms.client}>
                <select
                    value={send.clientId}
                    onChange={(e) => {
                        send.setClientId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.forms.selectClient}</option>
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
                label={strings.forms.sendForm}
            />
        </Panel>
    );
}

function FormBuilderPanel({ onDone }: { onDone: () => void }) {
    const builder = useFormBuilder(onDone);

    return (
        <Panel title={strings.forms.newForm}>
            <PickerRow label={strings.forms.formName}>
                <input
                    value={builder.name}
                    onChange={(e) => {
                        builder.setName(e.target.value);
                    }}
                    placeholder={strings.forms.formNamePlaceholder}
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
                {strings.forms.addField}
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
                {strings.forms.requireSignature}
            </label>

            {builder.error !== null ? <p className="text-sm text-danger">{builder.error}</p> : null}
            <PanelActions
                onCancel={onDone}
                busy={builder.busy}
                onSubmit={builder.submit}
                label={strings.forms.createForm}
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
                    {strings.forms.fieldN(index + 1)}
                </span>
                {onRemove !== undefined ? (
                    <button
                        type="button"
                        onClick={onRemove}
                        className="text-xs font-medium text-danger hover:underline"
                    >
                        {strings.forms.remove}
                    </button>
                ) : null}
            </div>
            <div className="mt-2 flex gap-2">
                <input
                    value={f.label}
                    onChange={(e) => {
                        onChange({ label: e.target.value });
                    }}
                    placeholder={strings.forms.fieldLabelPlaceholder}
                    className={`${field} flex-1`}
                />
                <select
                    value={f.input}
                    onChange={(e) => {
                        onChange({ input: e.target.value });
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
            {hasOptions(f.input) ? (
                <input
                    value={f.options}
                    onChange={(e) => {
                        onChange({ options: e.target.value });
                    }}
                    placeholder={strings.forms.optionsPlaceholder}
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
                {strings.forms.required}
            </label>
        </div>
    );
}

function ContractsSection() {
    const contracts = useContracts();
    const [mode, setMode] = useState<"none" | "send" | "create">("none");

    return (
        <section>
            <SectionHead
                title={strings.contracts.contracts}
                onCreate={() => {
                    setMode((m) => (m === "create" ? "none" : "create"));
                }}
                onSend={() => {
                    setMode((m) => (m === "send" ? "none" : "send"));
                }}
                createLabel={strings.contracts.newContract}
                sendLabel={strings.contracts.sendForSignature}
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
                    <Empty message={strings.contracts.emptyContracts} />
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
                <p className="text-xs text-muted">{strings.contracts.version(contract.version)}</p>
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
        <Panel title={strings.contracts.sendForSignature}>
            <PickerRow label={strings.contracts.contract}>
                <select
                    value={send.contractId}
                    onChange={(e) => {
                        send.setContractId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.contracts.selectContract}</option>
                    {contracts.map((cnt) => (
                        <option key={cnt.id} value={cnt.id}>
                            {cnt.name}
                        </option>
                    ))}
                </select>
            </PickerRow>
            <PickerRow label={strings.contracts.client}>
                <select
                    value={send.clientId}
                    onChange={(e) => {
                        send.setClientId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.contracts.selectClient}</option>
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
                label={strings.contracts.send}
            />
            <p className="text-xs text-muted">
                {strings.contracts.secureLinkNotice} <SignatureStatusLegend />
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
        <Panel title={strings.contracts.newContract}>
            <PickerRow label={strings.contracts.name}>
                <input
                    value={draft.name}
                    onChange={(e) => {
                        draft.setName(e.target.value);
                    }}
                    placeholder={strings.contracts.contractNamePlaceholder}
                    className={field}
                />
            </PickerRow>
            <PickerRow label={strings.contracts.contractText}>
                <textarea
                    value={draft.body}
                    onChange={(e) => {
                        draft.setBody(e.target.value);
                    }}
                    rows={8}
                    placeholder={strings.contracts.contractTextPlaceholder}
                    className={`${field} resize-y`}
                />
            </PickerRow>
            {draft.error !== null ? <p className="text-sm text-danger">{draft.error}</p> : null}
            <PanelActions
                onCancel={onDone}
                busy={draft.busy}
                onSubmit={draft.submit}
                label={strings.contracts.createContract}
            />
        </Panel>
    );
}

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
                {strings.common.cancel}
            </button>
            <button
                type="button"
                onClick={onSubmit}
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
                {busy ? strings.common.working : label}
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
