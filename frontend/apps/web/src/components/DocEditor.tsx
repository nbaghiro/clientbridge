import {
    type DocDraft,
    type DocTerms,
    discountCents,
    discountLabel,
    formatMoney,
    sellableItems,
    strings,
    useCatalogItems,
    useClients,
    useDocComposer,
    useLetterhead,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Checkbox,
    DocTotals,
    Empty,
    Icon,
    IconButton,
    Modal,
    Notice,
    PrintedDocument,
    Select,
    StatusPill,
    TextField,
    confirm,
} from "@clientbridge/ui";
import { cssVar } from "@clientbridge/tokens";
import { useMemo, useState } from "react";

import { api } from "../lib/api";
import { DiscountForm } from "./SaleTicket";

const s = strings.billing;

export interface DocEditorProps {
    kind: "invoice" | "estimate";
    draft?: DocDraft | undefined;
    onClose: () => void;
    onSent?: ((id: string) => void) | undefined;
}

export function DocEditor({ kind, draft, onClose, onSent }: DocEditorProps) {
    const clients = useClients();
    const items = useCatalogItems();
    const catalog = useMemo(() => sellableItems(items), [items]);
    const letterhead = useLetterhead();
    const c = useDocComposer(api, kind, draft, onSent);
    const [showPreview, setShowPreview] = useState(false);
    const [discounting, setDiscounting] = useState<string | null>(null);
    const client = clients.find((x) => x.id === c.clientId) ?? null;
    const doc = c.preview(client, letterhead, cssVar("accent"));

    const close = (): void => {
        if (!c.dirty || c.sent !== null) {
            onClose();
            return;
        }
        confirm({
            title: s.discardTitle,
            message: s.discardBody,
            confirmLabel: s.discard,
            cancelLabel: s.keepEditing,
            destructive: true,
        })
            .then((ok) => {
                if (ok) onClose();
            })
            .catch(() => undefined);
    };

    return (
        <Modal onClose={close} size="xl" framed={false}>
            <div className="@container flex h-[92vh] flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-card">
                <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-4">
                    <h2 className="font-display text-xl font-bold text-ink">{c.title}</h2>
                    <StatusPill status={s.statusLabel.draft ?? ""} intent="neutral" />
                    <div className="ml-auto flex items-center gap-2">
                        <span className="@4xl:hidden">
                            <Button
                                variant="quiet"
                                icon="eye"
                                onPress={() => {
                                    setShowPreview((v) => !v);
                                }}
                            >
                                {s.preview}
                            </Button>
                        </span>
                        {c.sent === null ? (
                            <>
                                <Button
                                    variant="outline"
                                    busy={c.busy}
                                    disabled={c.sending}
                                    onPress={c.saveDraft}
                                >
                                    {c.busy ? s.saving : s.saveDraft}
                                </Button>
                                <Button
                                    icon="send"
                                    busy={c.sending}
                                    disabled={c.busy}
                                    onPress={c.send}
                                >
                                    {c.sending
                                        ? s.sending
                                        : kind === "invoice"
                                          ? s.sendInvoice
                                          : s.sendEstimate}
                                </Button>
                            </>
                        ) : null}
                        <IconButton icon="x" label={strings.common.close} onPress={close} />
                    </div>
                </header>

                {c.sent !== null ? (
                    <div className="flex flex-1 items-center justify-center p-8">
                        <Empty
                            variant="card"
                            icon="check"
                            message={c.sent}
                            body={s.sentBody(client?.name ?? "")}
                            actions={
                                <>
                                    <Button onPress={onClose}>{strings.common.done}</Button>
                                    <Button variant="outline" onPress={c.startOver}>
                                        {s.startAnother}
                                    </Button>
                                </>
                            }
                        />
                    </div>
                ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-1 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div
                            className={`min-h-0 space-y-6 overflow-y-auto px-6 py-6 ${showPreview ? "max-@4xl:hidden" : ""}`}
                        >
                            <ClientPicker
                                clients={clients}
                                value={c.clientId}
                                editing={c.editing}
                                error={c.clientError}
                                onChange={c.setClientId}
                            />

                            <section className="space-y-3">
                                <div className="flex items-baseline justify-between gap-4">
                                    <h3 className="text-sm font-semibold text-ink">{s.lines}</h3>
                                    <p className="text-xs text-muted">{c.rateNote}</p>
                                </div>
                                {c.lines.map((l) => (
                                    <div
                                        key={l.key}
                                        className="space-y-3 rounded-lg border border-line bg-surface p-4"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <TextField
                                                    name={s.description}
                                                    value={l.description}
                                                    placeholder={s.descriptionPlaceholder}
                                                    onChange={(v) => {
                                                        c.setLine(l.key, {
                                                            description: v,
                                                            itemId: null,
                                                        });
                                                    }}
                                                />
                                            </div>
                                            <span className="w-24 text-right font-display font-bold tabular-nums text-ink">
                                                {l.discount !== null ? (
                                                    <span className="block text-xs font-normal text-muted line-through">
                                                        {formatMoney(l.grossCents)}
                                                    </span>
                                                ) : null}
                                                {formatMoney(
                                                    l.grossCents -
                                                        discountCents(l.grossCents, l.discount),
                                                )}
                                            </span>
                                            <IconButton
                                                icon="trash"
                                                label={s.removeLine}
                                                onPress={() => {
                                                    c.removeLine(l.key);
                                                }}
                                            />
                                        </div>
                                        <div className="grid grid-cols-[5rem_7rem_minmax(0,1fr)] gap-3">
                                            <TextField
                                                label={s.qty}
                                                size="sm"
                                                value={l.quantity}
                                                type="number"
                                                min="0"
                                                step="any"
                                                onChange={(v) => {
                                                    c.setLine(l.key, { quantity: v });
                                                }}
                                            />
                                            <TextField
                                                label={s.price}
                                                size="sm"
                                                prefix="$"
                                                value={l.unit}
                                                placeholder="0.00"
                                                onChange={(v) => {
                                                    c.setLine(l.key, { unit: v });
                                                }}
                                            />
                                            <Select
                                                label={s.taxClass}
                                                size="sm"
                                                value={l.taxClass}
                                                options={c.taxClassOptions}
                                                onChange={(v) => {
                                                    c.setLine(l.key, {
                                                        taxClass:
                                                            v === "federal_only" || v === "exempt"
                                                                ? v
                                                                : "standard",
                                                    });
                                                }}
                                            />
                                        </div>
                                        {kind === "estimate" ? (
                                            <div>
                                                <Checkbox
                                                    label={s.optional}
                                                    value={l.optional}
                                                    onChange={(v) => {
                                                        c.setLine(l.key, { optional: v });
                                                    }}
                                                />
                                                {l.optional ? (
                                                    <p className="ml-7 text-xs text-muted">
                                                        {s.optionalHint}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {discounting === l.key ? (
                                            <DiscountForm
                                                title={s.lineDiscount(
                                                    l.description || s.descriptionPlaceholder,
                                                )}
                                                initial={l.discount}
                                                baseCents={l.grossCents}
                                                onApply={(next) => {
                                                    c.setLineDiscount(l.key, next);
                                                    setDiscounting(null);
                                                }}
                                                onCancel={() => {
                                                    setDiscounting(null);
                                                }}
                                            />
                                        ) : (
                                            <Button
                                                variant="link"
                                                size="sm"
                                                icon="percent"
                                                disabled={l.grossCents <= 0}
                                                onPress={() => {
                                                    setDiscounting(l.key);
                                                }}
                                            >
                                                {l.discount !== null
                                                    ? s.discountedBy(discountLabel(l.discount))
                                                    : s.addDiscount}
                                            </Button>
                                        )}
                                        {l.error !== null ? (
                                            <Notice tone="danger">{l.error}</Notice>
                                        ) : null}
                                    </div>
                                ))}
                                <div className="flex flex-wrap items-end gap-3">
                                    {catalog.length > 0 ? (
                                        <div className="w-64">
                                            <Select
                                                name={s.addFromCatalog}
                                                value=""
                                                options={[
                                                    { key: "", label: s.addFromCatalog },
                                                    ...catalog.map((i) => ({
                                                        key: i.id,
                                                        label: `${i.name} · ${formatMoney(i.price_cents)}`,
                                                    })),
                                                ]}
                                                onChange={(id) => {
                                                    const item = catalog.find((i) => i.id === id);
                                                    if (item !== undefined) c.addCatalogItem(item);
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                    <Button variant="outline" icon="plus" onPress={c.addLine}>
                                        {s.addCustomLine}
                                    </Button>
                                </div>
                                {c.linesError !== null ? (
                                    <Notice tone="danger">{c.linesError}</Notice>
                                ) : null}
                            </section>

                            <div className="ml-auto max-w-sm space-y-3">
                                {discounting === "doc" ? (
                                    <DiscountForm
                                        title={s.discountTitle}
                                        initial={c.docDiscount}
                                        baseCents={c.discountBaseCents}
                                        onApply={(next) => {
                                            c.setDocDiscount(next);
                                            setDiscounting(null);
                                        }}
                                        onCancel={() => {
                                            setDiscounting(null);
                                        }}
                                    />
                                ) : (
                                    <div className="flex justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            icon="percent"
                                            disabled={c.discountBaseCents <= 0}
                                            onPress={() => {
                                                setDiscounting("doc");
                                            }}
                                        >
                                            {c.docDiscount !== null
                                                ? s.discountedBy(discountLabel(c.docDiscount))
                                                : s.discountTitle}
                                        </Button>
                                    </div>
                                )}
                                <DocTotals lines={c.totals} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Select<DocTerms>
                                    label={kind === "estimate" ? s.validFor : s.dueTerms}
                                    value={c.terms}
                                    options={c.termOptions}
                                    onChange={c.setTerms}
                                />
                            </div>
                            <TextField
                                label={s.messageToClient}
                                optional
                                multiline
                                rows={3}
                                value={c.message}
                                placeholder={s.messagePlaceholder}
                                onChange={c.setMessage}
                            />
                            {c.saved !== null ? <Notice tone="success">{c.saved}</Notice> : null}
                            {c.error !== null ? <Notice tone="danger">{c.error}</Notice> : null}
                        </div>

                        <aside
                            className={`min-h-0 overflow-y-auto border-l border-line bg-bg px-6 py-6 ${showPreview ? "" : "max-@4xl:hidden"}`}
                        >
                            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                <Icon name="eye" size={14} />
                                {s.livePreview}
                            </p>
                            <PrintedDocument doc={doc} />
                        </aside>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function ClientPicker({
    clients,
    value,
    editing,
    error,
    onChange,
}: {
    clients: readonly { id: string; name: string; email: string | null }[];
    value: string;
    editing: boolean;
    error: string | null;
    onChange: (id: string) => void;
}) {
    const chosen = clients.find((x) => x.id === value) ?? null;
    if (editing && chosen !== null) {
        return (
            <section className="space-y-2">
                <h3 className="text-sm font-semibold text-ink">{s.client}</h3>
                <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                    <Avatar name={chosen.name} size="sm" />
                    <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{chosen.name}</p>
                        {chosen.email !== null ? (
                            <p className="truncate text-xs text-muted">{chosen.email}</p>
                        ) : null}
                    </div>
                </div>
            </section>
        );
    }
    return (
        <Select
            label={s.client}
            value={value}
            error={error}
            options={[
                { key: "", label: s.chooseClient },
                ...clients.map((x) => ({ key: x.id, label: x.name })),
            ]}
            onChange={onChange}
        />
    );
}
