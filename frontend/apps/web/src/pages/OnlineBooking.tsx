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
import {
    Button,
    Empty,
    Notice,
    Panel,
    Select,
    StatusPill,
    Tabs,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";

import {
    AddonOffers,
    BookingPageSettings,
    BookingPolicySettings,
} from "../components/OnlineBookingSettings";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

export function OnlineBooking() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <div className="max-w-3xl">
                <p className="mt-1 text-sm text-muted">{strings.forms.ownerAdminOnly}</p>
            </div>
        );
    }

    return <OnlineTabs />;
}

type OnlineTab = "page" | "addons" | "policy" | "forms";

function OnlineTabs() {
    const [tab, setTab] = useState<OnlineTab>("page");
    const o = strings.onlineBooking;
    return (
        <div className="space-y-6">
            <Tabs
                label={o.title}
                items={[
                    { key: "page", label: o.tabPage },
                    { key: "addons", label: o.tabAddons },
                    { key: "policy", label: o.tabPolicy },
                    { key: "forms", label: o.tabForms },
                ]}
                active={tab}
                onSelect={setTab}
            />
            {tab === "page" ? <BookingPageSettings /> : null}
            {tab === "addons" ? <AddonOffers /> : null}
            {tab === "policy" ? <BookingPolicySettings /> : null}
            {tab === "forms" ? (
                <div className="max-w-3xl space-y-10">
                    <div>
                        <p className="mt-1 text-sm text-muted">{strings.forms.intro}</p>
                    </div>
                    <FormsSection />
                    <ContractsSection />
                </div>
            ) : null}
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
        <div className="mt-4">
            <Panel title={strings.forms.sendFormTitle}>
                <Select
                    label={strings.forms.form}
                    value={send.formId}
                    options={[
                        { key: "", label: strings.forms.selectForm },
                        ...forms.map((f) => ({ key: f.id, label: f.name })),
                    ]}
                    onChange={send.setFormId}
                />
                <Select
                    label={strings.forms.client}
                    value={send.clientId}
                    options={[
                        { key: "", label: strings.forms.selectClient },
                        ...clients.map((cl) => ({ key: cl.id, label: cl.name })),
                    ]}
                    onChange={send.setClientId}
                />
                {send.error !== null ? <Notice tone="danger">{send.error}</Notice> : null}
                <PanelActions
                    onCancel={onDone}
                    busy={send.busy}
                    onSubmit={send.submit}
                    label={strings.forms.sendForm}
                />
            </Panel>
        </div>
    );
}

function FormBuilderPanel({ onDone }: { onDone: () => void }) {
    const builder = useFormBuilder(onDone);

    return (
        <div className="mt-4">
            <Panel title={strings.forms.newForm}>
                <TextField
                    label={strings.forms.formName}
                    value={builder.name}
                    onChange={builder.setName}
                    placeholder={strings.forms.formNamePlaceholder}
                />

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

                <Button variant="outline" size="sm" onPress={builder.addField}>
                    {strings.forms.addField}
                </Button>

                <Toggle
                    label={strings.forms.requireSignature}
                    value={builder.requireSignature}
                    onChange={builder.setRequireSignature}
                />

                {builder.error !== null ? <Notice tone="danger">{builder.error}</Notice> : null}
                <PanelActions
                    onCancel={onDone}
                    busy={builder.busy}
                    onSubmit={builder.submit}
                    label={strings.forms.createForm}
                />
            </Panel>
        </div>
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
                    <Button variant="danger" size="sm" onPress={onRemove}>
                        {strings.forms.remove}
                    </Button>
                ) : null}
            </div>
            <div className="mt-2 flex gap-2">
                <div className="flex-1">
                    <TextField
                        surface="surface"
                        value={f.label}
                        onChange={(label) => {
                            onChange({ label });
                        }}
                        placeholder={strings.forms.fieldLabelPlaceholder}
                    />
                </div>
                <div className="w-40">
                    <Select
                        name={strings.forms.fieldType}
                        value={f.input}
                        options={BUILDER_FIELD_TYPES.map((t) => ({
                            key: t,
                            label: FIELD_TYPE_LABEL[t] ?? t,
                        }))}
                        onChange={(input) => {
                            onChange({ input });
                        }}
                    />
                </div>
            </div>
            {hasOptions(f.input) ? (
                <div className="mt-2">
                    <TextField
                        surface="surface"
                        value={f.options}
                        onChange={(options) => {
                            onChange({ options });
                        }}
                        placeholder={strings.forms.optionsPlaceholder}
                    />
                </div>
            ) : null}
            <div className="mt-2">
                <Toggle
                    label={strings.forms.required}
                    value={f.required}
                    onChange={(required) => {
                        onChange({ required });
                    }}
                />
            </div>
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
        <div className="mt-4">
            <Panel title={strings.contracts.sendForSignature}>
                <Select
                    label={strings.contracts.contract}
                    value={send.contractId}
                    options={[
                        { key: "", label: strings.contracts.selectContract },
                        ...contracts.map((cnt) => ({ key: cnt.id, label: cnt.name })),
                    ]}
                    onChange={send.setContractId}
                />
                <Select
                    label={strings.contracts.client}
                    value={send.clientId}
                    options={[
                        { key: "", label: strings.contracts.selectClient },
                        ...clients.map((cl) => ({ key: cl.id, label: cl.name })),
                    ]}
                    onChange={send.setClientId}
                />
                {send.error !== null ? <Notice tone="danger">{send.error}</Notice> : null}
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
        </div>
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
        <div className="mt-4">
            <Panel title={strings.contracts.newContract}>
                <TextField
                    label={strings.contracts.name}
                    value={draft.name}
                    onChange={draft.setName}
                    placeholder={strings.contracts.contractNamePlaceholder}
                />
                <TextField
                    label={strings.contracts.contractText}
                    multiline
                    rows={8}
                    value={draft.body}
                    onChange={draft.setBody}
                    placeholder={strings.contracts.contractTextPlaceholder}
                />
                {draft.error !== null ? <Notice tone="danger">{draft.error}</Notice> : null}
                <PanelActions
                    onCancel={onDone}
                    busy={draft.busy}
                    onSubmit={draft.submit}
                    label={strings.contracts.createContract}
                />
            </Panel>
        </div>
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
                    <Button variant="outline" size="sm" onPress={onSend}>
                        {sendLabel}
                    </Button>
                ) : null}
                <Button size="sm" onPress={onCreate}>
                    {createLabel}
                </Button>
            </div>
        </div>
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
            <Button variant="quiet" onPress={onCancel}>
                {strings.common.cancel}
            </Button>
            <Button onPress={onSubmit} busy={busy}>
                {busy ? strings.common.working : label}
            </Button>
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
