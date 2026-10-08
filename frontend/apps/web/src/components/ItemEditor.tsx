import {
    DEPOSIT_TYPES,
    FREQUENCIES,
    type ItemForm,
    type ItemRow,
    KIND_LABEL,
    type PlanEditor,
    type ProductEditor,
    type ServiceEditor,
    formatMoney,
    mediaUrl,
    strings,
    usePlanEditor,
    useProductEditor,
    useServiceEditor,
} from "@clientbridge/app-core";
import {
    Button,
    Choice,
    DetailSection,
    DetailView,
    DurationBar,
    ImagePicker,
    ItemImage,
    Notice,
    Select,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { type ChangeEvent, type ReactNode, useRef } from "react";

import { api, apiBaseUrl } from "../lib/api";

const s = strings.catalog;

function Num({
    label,
    value,
    onChange,
    prefix,
    hint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    prefix?: string | undefined;
    hint?: string | undefined;
}) {
    return (
        <div className="min-w-0 flex-1">
            <TextField
                label={label}
                type="number"
                value={value}
                onChange={onChange}
                prefix={prefix}
                hint={hint}
            />
        </div>
    );
}

function TaxField({
    ed,
    hint,
}: {
    ed: { form: ItemForm; tax: string; taxOptions: { key: string; label: string }[] };
    hint: string;
}) {
    return (
        <div className="space-y-2">
            <Choice
                layout="segmented"
                label={s.taxClass}
                options={ed.taxOptions}
                value={ed.form.values.taxClass}
                onChange={(x) => {
                    ed.form.set("taxClass", x);
                }}
            />
            <p className="text-sm text-ink-soft">{ed.tax}</p>
            <p className="text-xs text-muted">{hint}</p>
        </div>
    );
}

function BasicsFields({ form, placeholder }: { form: ItemForm; placeholder: string }) {
    const v = form.values;
    return (
        <div className="space-y-3">
            <TextField
                label={s.name}
                value={v.name}
                placeholder={placeholder}
                onChange={(x) => {
                    form.set("name", x);
                }}
            />
            <TextField
                label={s.description}
                hint={s.descriptionHint}
                multiline
                rows={2}
                value={v.description}
                onChange={(x) => {
                    form.set("description", x);
                }}
            />
            <TextField
                label={s.category}
                value={v.category}
                onChange={(x) => {
                    form.set("category", x);
                }}
            />
        </div>
    );
}

function ServiceFields({ ed }: { ed: ServiceEditor }) {
    const v = ed.form.values;
    const set = ed.form.set;
    return (
        <>
            <DetailSection title={s.sectionBasics}>
                <BasicsFields form={ed.form} placeholder={s.namePlaceholderService} />
            </DetailSection>
            <DetailSection title={s.sectionTime}>
                <div className="space-y-3">
                    <div className="flex gap-3">
                        <Num
                            label={s.price}
                            prefix="$"
                            value={v.price}
                            onChange={(x) => {
                                set("price", x);
                            }}
                        />
                        <Num
                            label={s.durationLabel}
                            value={v.duration}
                            onChange={(x) => {
                                set("duration", x);
                            }}
                        />
                    </div>
                    <div className="flex gap-3">
                        <Num
                            label={s.bufferBefore}
                            value={v.bufferBefore}
                            onChange={(x) => {
                                set("bufferBefore", x);
                            }}
                        />
                        <Num
                            label={s.bufferAfter}
                            value={v.bufferAfter}
                            onChange={(x) => {
                                set("bufferAfter", x);
                            }}
                        />
                    </div>
                    <DurationBar segments={ed.timing.segments} caption={ed.timing.caption} />
                </div>
            </DetailSection>
            <DetailSection title={s.sectionBooking}>
                <div className="space-y-3">
                    {ed.isClass ? (
                        <div className="w-40">
                            <TextField
                                label={s.capacity}
                                hint={s.capacityHint}
                                type="number"
                                value={v.capacity}
                                onChange={(x) => {
                                    set("capacity", x);
                                }}
                            />
                        </div>
                    ) : null}
                    <Toggle
                        label={s.onlineBookable}
                        hint={s.onlineBookableHint}
                        value={v.onlineBookable}
                        onChange={(x) => {
                            set("onlineBookable", x);
                        }}
                    />
                </div>
            </DetailSection>
            <DetailSection title={s.sectionDeposit}>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <Choice
                            layout="segmented"
                            label={s.sectionDeposit}
                            options={DEPOSIT_TYPES.map((d) => ({ key: d.value, label: d.label }))}
                            value={v.depositType}
                            onChange={(x) => {
                                set("depositType", x);
                            }}
                        />
                        {v.depositType !== "none" ? (
                            <div className="w-36">
                                <TextField
                                    label={
                                        v.depositType === "fixed"
                                            ? s.depositAmount
                                            : s.depositPercentLabel
                                    }
                                    type="number"
                                    prefix={v.depositType === "fixed" ? "$" : undefined}
                                    value={v.depositValue}
                                    onChange={(x) => {
                                        set("depositValue", x);
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                    <p
                        className={`rounded-md px-3 py-2 text-sm ${
                            v.depositType === "none" ? "bg-bg text-muted" : "bg-ok-bg text-ok-fg"
                        }`}
                    >
                        {ed.deposit}
                    </p>
                </div>
            </DetailSection>
            <DetailSection title={s.sectionTax}>
                <TaxField ed={ed} hint={s.taxHintService} />
            </DetailSection>
        </>
    );
}

function PhotoField({ ed }: { ed: ProductEditor }) {
    const input = useRef<HTMLInputElement>(null);
    const src = mediaUrl(apiBaseUrl, ed.photo.fileId);
    const onFile = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file !== undefined) ed.photo.upload(file, file.type || "image/png", file.size);
        e.target.value = "";
    };
    if (!ed.photo.canUpload) return <p className="text-sm text-muted">{s.photoAfterSave}</p>;
    return (
        <div className="space-y-2">
            <ImagePicker
                src={src}
                name={ed.form.values.name}
                label={src === null ? s.photo : s.changePhoto}
                hint={s.photoHint}
                busy={ed.photo.busy}
                onPick={() => {
                    input.current?.click();
                }}
            />
            <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFile}
                className="hidden"
            />
            {ed.photo.error !== null ? <Notice tone="danger">{ed.photo.error}</Notice> : null}
            {ed.photo.uploaded ? <p className="text-xs text-ok-fg">{s.photoUploaded}</p> : null}
        </div>
    );
}

function ProductFields({ ed }: { ed: ProductEditor }) {
    const v = ed.form.values;
    const set = ed.form.set;
    return (
        <>
            <DetailSection title={s.sectionImage}>
                <PhotoField ed={ed} />
            </DetailSection>
            <DetailSection title={s.sectionBasics}>
                <BasicsFields form={ed.form} placeholder={s.namePlaceholderProduct} />
                <div className="mt-3">
                    <TextField
                        label={s.sku}
                        hint={s.skuHint}
                        value={v.sku}
                        onChange={(x) => {
                            set("sku", x);
                        }}
                    />
                </div>
            </DetailSection>
            <DetailSection title={s.sectionPrice}>
                <div className="space-y-2">
                    <div className="flex gap-3">
                        <Num
                            label={s.price}
                            prefix="$"
                            value={v.price}
                            onChange={(x) => {
                                set("price", x);
                            }}
                        />
                        <Num
                            label={s.cost}
                            prefix="$"
                            value={v.cost}
                            onChange={(x) => {
                                set("cost", x);
                            }}
                        />
                    </div>
                    <div
                        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                            ed.margin?.low === true
                                ? "bg-warn-bg text-warn-fg"
                                : "bg-bg text-ink-soft"
                        }`}
                    >
                        <span className="text-muted">{s.margin}</span>
                        <span className="font-semibold tabular-nums">
                            {ed.margin === null ? s.marginUnknown : ed.margin.label}
                        </span>
                    </div>
                    {ed.margin?.low === true ? (
                        <p className="text-xs text-warn-fg">{s.marginLow}</p>
                    ) : null}
                    <p className="text-xs text-muted">{s.costHint}</p>
                </div>
            </DetailSection>
            <DetailSection title={s.sectionStock}>
                <div className="space-y-3">
                    <Toggle
                        label={s.trackStock}
                        hint={s.trackStockHint}
                        value={v.trackStock}
                        onChange={(x) => {
                            set("trackStock", x);
                        }}
                    />
                    {v.trackStock ? (
                        <div className="flex gap-3">
                            {ed.form.editing ? null : (
                                <Num
                                    label={s.stockOnHand}
                                    value={v.openingStock}
                                    onChange={(x) => {
                                        set("openingStock", x);
                                    }}
                                />
                            )}
                            <Num
                                label={s.lowAt}
                                hint={s.lowAtHint}
                                value={v.lowStockAt}
                                onChange={(x) => {
                                    set("lowStockAt", x);
                                }}
                            />
                        </div>
                    ) : null}
                    {ed.sold30 > 0 ? (
                        <p className="text-xs text-muted">{s.sold30(ed.sold30)}</p>
                    ) : null}
                </div>
            </DetailSection>
            <DetailSection title={s.sectionShop}>
                <Select
                    label={s.variantParent}
                    value={v.variantParentId ?? ""}
                    options={ed.parentOptions}
                    onChange={(value) => {
                        set("variantParentId", value);
                    }}
                />
                {v.variantParentId ? (
                    <TextField
                        label={s.variantLabel}
                        hint={s.variantHint}
                        value={v.variantLabel ?? ""}
                        onChange={(value) => {
                            set("variantLabel", value);
                        }}
                        maxLength={80}
                    />
                ) : null}
                <Toggle
                    label={s.sellOnline}
                    hint={s.sellOnlineHint}
                    value={v.sellOnline}
                    onChange={(x) => {
                        set("sellOnline", x);
                    }}
                />
            </DetailSection>
            <DetailSection title={s.sectionTax}>
                <TaxField ed={ed} hint={s.taxHintProduct} />
            </DetailSection>
        </>
    );
}

function PlanFields({ ed }: { ed: PlanEditor }) {
    const v = ed.form.values;
    const set = ed.form.set;
    return (
        <>
            <DetailSection title={s.sectionBasics}>
                <div className="space-y-3">
                    <TextField
                        label={s.name}
                        value={v.name}
                        onChange={(x) => {
                            set("name", x);
                        }}
                    />
                    <TextField
                        label={s.description}
                        multiline
                        rows={2}
                        value={v.description}
                        onChange={(x) => {
                            set("description", x);
                        }}
                    />
                </div>
            </DetailSection>
            <DetailSection title={s.sectionPlan}>
                <div className="space-y-3">
                    {v.kind === "package" ? (
                        <>
                            <Select
                                label={s.covers}
                                hint={s.coversHint}
                                value={v.coversItemId}
                                options={[{ key: "", label: s.chooseService }, ...ed.coverOptions]}
                                onChange={(x) => {
                                    set("coversItemId", x);
                                }}
                            />
                            <div className="flex gap-3">
                                <Num
                                    label={s.visitsLabel}
                                    value={v.sessionCount}
                                    onChange={(x) => {
                                        set("sessionCount", x);
                                    }}
                                />
                                <Num
                                    label={s.price}
                                    prefix="$"
                                    value={v.price}
                                    onChange={(x) => {
                                        set("price", x);
                                    }}
                                />
                                <Num
                                    label={s.validForDays}
                                    hint={s.noExpiryHint}
                                    value={v.validityDays}
                                    onChange={(x) => {
                                        set("validityDays", x);
                                    }}
                                />
                            </div>
                        </>
                    ) : null}
                    {v.kind === "subscription" ? (
                        <>
                            <div className="flex gap-3">
                                <Num
                                    label={s.price}
                                    prefix="$"
                                    value={v.price}
                                    onChange={(x) => {
                                        set("price", x);
                                    }}
                                />
                                <div className="min-w-0 flex-1">
                                    <Select
                                        label={s.billsEvery}
                                        value={v.frequency}
                                        options={FREQUENCIES.map((f) => ({
                                            key: f.value,
                                            label: f.label,
                                        }))}
                                        onChange={(x) => {
                                            set("frequency", x);
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <Num
                                    label={s.includes}
                                    hint={s.includesHint}
                                    value={v.visitsPerPeriod}
                                    onChange={(x) => {
                                        set("visitsPerPeriod", x);
                                    }}
                                />
                                <Num
                                    label={s.memberPerk}
                                    hint={s.memberPerkHint}
                                    value={v.memberDiscount}
                                    onChange={(x) => {
                                        set("memberDiscount", x);
                                    }}
                                />
                            </div>
                        </>
                    ) : null}
                    {v.kind === "gift" ? (
                        <>
                            <p className="text-sm font-medium text-ink">{s.giftAmounts}</p>
                            <Choice
                                label={s.giftAmounts}
                                options={ed.giftChoices.map((c) => ({
                                    key: String(c),
                                    label: formatMoney(c),
                                }))}
                                value={v.giftAmounts.map(String)}
                                onChange={(k) => {
                                    ed.toggleGiftAmount(Number(k));
                                }}
                            />
                            <p className="text-xs text-muted">{s.giftAmountsHint}</p>
                        </>
                    ) : null}
                </div>
            </DetailSection>
            <div className="rounded-md border border-accent-line bg-accent-weak/50 px-4 py-3">
                <p className="text-sm font-semibold text-ink">{ed.facts.summary}</p>
                {ed.facts.perVisit !== null ? (
                    <p className="mt-0.5 text-sm text-ink-soft">{ed.facts.perVisit}</p>
                ) : null}
                {ed.facts.perYear !== null ? (
                    <p className="mt-0.5 text-sm text-ink-soft">{ed.facts.perYear}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted">{s.sellsAt}</p>
            </div>
        </>
    );
}

function Frame({
    item,
    kind,
    form,
    onClose,
    children,
}: {
    item: ItemRow | null;
    kind: string;
    form: ItemForm;
    onClose: () => void;
    children: ReactNode;
}) {
    const archived = item !== null && item.active !== 1;
    const kindLabel = KIND_LABEL[kind] ?? kind;
    return (
        <DetailView
            open
            title={item?.name ?? s.newItem(kindLabel)}
            subtitle={kindLabel}
            status={archived ? { status: s.archived, intent: "neutral" } : undefined}
            leading={
                <ItemImage
                    src={mediaUrl(apiBaseUrl, item?.image_file_id ?? null)}
                    name={item?.name ?? kindLabel}
                    color={item?.color ?? null}
                    size={40}
                />
            }
            onClose={onClose}
            actions={
                <>
                    {item === null ? null : (
                        <Button
                            variant="outline"
                            onPress={archived ? form.restore : form.archive}
                            disabled={form.busy}
                        >
                            {archived ? s.restore : s.archive}
                        </Button>
                    )}
                    <Button onPress={form.submit} busy={form.busy}>
                        {form.busy ? s.saving : item === null ? s.add : s.save}
                    </Button>
                </>
            }
        >
            {archived ? (
                <Notice tone="info" banner>
                    {s.archivedNote}
                </Notice>
            ) : null}
            {children}
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
        </DetailView>
    );
}

function ServicePanel({ item, kind, onClose }: EditorProps) {
    const ed = useServiceEditor(api, item, kind, onClose);
    return (
        <Frame item={item} kind={kind} form={ed.form} onClose={onClose}>
            <ServiceFields ed={ed} />
        </Frame>
    );
}

function ProductPanel({ item, onClose }: EditorProps) {
    const ed = useProductEditor(api, item, onClose);
    return (
        <Frame item={item} kind="product" form={ed.form} onClose={onClose}>
            <ProductFields ed={ed} />
        </Frame>
    );
}

function PlanPanel({ item, kind, items, onClose }: EditorProps) {
    const ed = usePlanEditor(api, item, kind, items, onClose);
    return (
        <Frame item={item} kind={kind} form={ed.form} onClose={onClose}>
            <PlanFields ed={ed} />
        </Frame>
    );
}

interface EditorProps {
    item: ItemRow | null;
    kind: string;
    items: readonly ItemRow[];
    onClose: () => void;
}

/** The item editor in a side panel, with the fields that kind of item uses. */
export function ItemEditor(props: EditorProps) {
    if (props.kind === "service" || props.kind === "class") return <ServicePanel {...props} />;
    if (props.kind === "product") return <ProductPanel {...props} />;
    return <PlanPanel {...props} />;
}
