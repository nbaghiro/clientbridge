import {
    type DocDraft,
    docEditorTitle,
    formatMoney,
    mediaUrl,
    sellableItems,
    strings,
    useCatalogItems,
    useClients,
    useDocForm,
} from "@clientbridge/app-core";
import { Button, ItemImage, Modal, Notice, Select, TextField } from "@clientbridge/ui";
import { useMemo, useState } from "react";

import { api, apiBaseUrl } from "../lib/api";

const box =
    "rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

export interface DocEditorProps {
    kind: "invoice" | "estimate";
    draft?: DocDraft | undefined;
    onClose: () => void;
}

export function DocEditor({ kind, draft, onClose }: DocEditorProps) {
    const clients = useClients();
    const items = useCatalogItems();
    const catalog = useMemo(() => sellableItems(items), [items]);
    const form = useDocForm(api, kind, onClose, draft);
    const [picking, setPicking] = useState(false);

    return (
        <Modal onClose={onClose} size="lg" framed={false}>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="flex max-h-[88vh] flex-col rounded-lg border border-line bg-surface shadow-card"
            >
                <h2 className="border-b border-line px-6 py-4 font-display text-lg font-bold text-ink">
                    {docEditorTitle(kind, form.editing)}
                </h2>
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <Select
                        label={strings.billing.clientLabel}
                        value={form.clientId}
                        disabled={form.editing}
                        options={[
                            { key: "", label: strings.billing.clientPlaceholder },
                            ...clients.map((c) => ({ key: c.id, label: c.name })),
                        ]}
                        onChange={form.setClientId}
                    />

                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                            <span className="flex-1">{strings.billing.lineDescription}</span>
                            <span className="w-14 text-center">{strings.billing.lineQty}</span>
                            <span className="w-24 text-right">{strings.billing.linePrice}</span>
                            <span className="w-5" />
                        </div>
                        {form.lines.map((l) => (
                            <div key={l.key} className="flex items-center gap-2">
                                <input
                                    value={l.description}
                                    onChange={(e) => {
                                        form.setLine(l.key, {
                                            description: e.target.value,
                                            itemId: null,
                                        });
                                    }}
                                    placeholder={strings.billing.lineDescriptionPlaceholder}
                                    className={`${box} min-w-0 flex-1`}
                                />
                                <input
                                    value={l.quantity}
                                    onChange={(e) => {
                                        form.setLine(l.key, { quantity: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    className={`${box} w-14 shrink-0 text-center`}
                                />
                                <input
                                    value={l.unit}
                                    onChange={(e) => {
                                        form.setLine(l.key, { unit: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    placeholder={strings.billing.linePricePlaceholder}
                                    className={`${box} w-24 shrink-0 text-right`}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        form.removeLine(l.key);
                                    }}
                                    className="w-5 text-muted transition hover:text-danger"
                                    aria-label={strings.billing.removeLine}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        <div className="flex gap-4">
                            <Button
                                variant="link"
                                onPress={() => {
                                    form.addLine();
                                }}
                            >
                                {strings.billing.addLine}
                            </Button>
                            {catalog.length > 0 ? (
                                <Button
                                    variant="link"
                                    onPress={() => {
                                        setPicking((p) => !p);
                                    }}
                                >
                                    {strings.billing.fromCatalog}
                                </Button>
                            ) : null}
                        </div>
                        {picking ? (
                            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-md border border-line p-2">
                                {catalog.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                            form.addCatalogItem(item);
                                            setPicking(false);
                                        }}
                                        className="flex items-center gap-2 rounded-md p-1.5 text-left transition hover:bg-bg"
                                    >
                                        <ItemImage
                                            src={mediaUrl(apiBaseUrl, item.image_file_id)}
                                            name={item.name}
                                            color={item.color}
                                            size={32}
                                        />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm text-ink">
                                                {item.name}
                                            </span>
                                            <span className="text-xs tabular-nums text-muted">
                                                {formatMoney(item.price_cents)}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <TextField
                        label={strings.billing.notesLabel}
                        multiline
                        rows={2}
                        value={form.notes}
                        onChange={form.setNotes}
                    />
                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}
                </div>
                <div className="flex items-center justify-between border-t border-line px-6 py-4">
                    <span className="text-sm text-muted">
                        {strings.billing.subtotal}{" "}
                        <span className="font-semibold text-ink">
                            {formatMoney(form.subtotalCents)}
                        </span>
                        <span className="text-xs">{strings.billing.plusTax}</span>
                    </span>
                    <div className="flex gap-2">
                        <Button variant="quiet" onPress={onClose}>
                            {strings.common.cancel}
                        </Button>
                        <Button submit busy={form.busy}>
                            {form.busy
                                ? strings.common.saving
                                : form.editing
                                  ? strings.billing.saveChanges
                                  : strings.billing.saveDraft}
                        </Button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
