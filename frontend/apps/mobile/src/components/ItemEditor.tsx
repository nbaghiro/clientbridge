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
    useAsyncAction,
    useProductEditor,
    useServiceEditor,
    BUSINESS_CURRENCY,
    currencyAffix,
    kindWord,
    useSubjectKind,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    DetailSection,
    DetailView,
    DurationBar,
    ImagePicker,
    Notice,
    SearchSelect,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { launchImageLibraryAsync } from "expo-image-picker";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api, apiBaseUrl } from "../lib/api";

const s = strings.catalog;
const c = theme.colors;

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
        <View style={styles.flex}>
            <TextField
                label={label}
                type="number"
                value={value}
                onChange={onChange}
                prefix={prefix}
                hint={hint}
            />
        </View>
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
        <View style={styles.gap}>
            <Choice
                layout="segmented"
                label={s.taxClass}
                options={ed.taxOptions}
                value={ed.form.values.taxClass}
                onChange={(x) => {
                    ed.form.set("taxClass", x);
                }}
            />
            <Text style={styles.facts}>{ed.tax}</Text>
            <Text style={styles.hint}>{hint}</Text>
        </View>
    );
}

function BasicsFields({ form, placeholder }: { form: ItemForm; placeholder: string }) {
    const v = form.values;
    return (
        <>
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
        </>
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
                <View style={styles.pair}>
                    <Num
                        label={s.price}
                        {...currencyAffix(BUSINESS_CURRENCY)}
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
                </View>
                <View style={styles.pair}>
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
                </View>
                <View style={styles.bar}>
                    <DurationBar segments={ed.timing.segments} caption={ed.timing.caption} />
                </View>
            </DetailSection>
            <DetailSection title={s.sectionBooking}>
                {ed.isClass ? (
                    <Num
                        label={s.capacity}
                        hint={s.capacityHint}
                        value={v.capacity}
                        onChange={(x) => {
                            set("capacity", x);
                        }}
                    />
                ) : null}
                {ed.isClass ? (
                    <Num
                        label={s.programDays}
                        hint={s.programDaysHint}
                        value={v.sessionCount}
                        onChange={(x) => {
                            set("sessionCount", x);
                        }}
                    />
                ) : null}
                <Toggle
                    label={s.onlineBookable}
                    hint={s.onlineBookableHint}
                    value={v.onlineBookable}
                    onChange={(x) => {
                        set("onlineBookable", x);
                    }}
                />
                {ed.offeredBy !== null ? (
                    <>
                        <Text style={styles.label}>{s.offeredBy}</Text>
                        <Choice
                            label={s.offeredBy}
                            options={ed.offeredBy.options}
                            value={ed.offeredBy.value}
                            onChange={ed.offeredBy.pick}
                        />
                        <Text style={styles.hint}>{s.offeredByHint}</Text>
                    </>
                ) : null}
                {ed.needs !== null ? (
                    <>
                        <Text style={styles.label}>{s.needs}</Text>
                        <Choice
                            label={s.needs}
                            options={ed.needs.options}
                            value={ed.needs.value}
                            onChange={ed.needs.pick}
                        />
                        <Text style={styles.hint}>{s.needsHint}</Text>
                    </>
                ) : null}
            </DetailSection>
            <DetailSection title={s.sectionDeposit}>
                <View style={styles.gap}>
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
                        <Num
                            label={
                                v.depositType === "fixed" ? s.depositAmount : s.depositPercentLabel
                            }
                            {...(v.depositType === "fixed" ? currencyAffix(BUSINESS_CURRENCY) : {})}
                            value={v.depositValue}
                            onChange={(x) => {
                                set("depositValue", x);
                            }}
                        />
                    ) : null}
                    <Text style={[styles.summary, v.depositType !== "none" && styles.summaryOn]}>
                        {ed.deposit}
                    </Text>
                </View>
            </DetailSection>
            <DetailSection title={s.sectionTax}>
                <TaxField ed={ed} hint={s.taxHintService} />
            </DetailSection>
        </>
    );
}

function ProductFields({ ed }: { ed: ProductEditor }) {
    const word = kindWord(useSubjectKind());
    const picker = useAsyncAction();
    const pick = (): void => {
        picker.run(
            async () => {
                const result = await launchImageLibraryAsync({
                    mediaTypes: ["images"],
                    quality: 0.85,
                });
                const asset = result.assets?.[0];
                if (!asset) return;
                const blob = await (await fetch(asset.uri)).blob();
                ed.photo.upload(blob, asset.mimeType ?? "image/jpeg", asset.fileSize);
            },
            { errorMessage: strings.common.fileUploadError },
        );
    };
    const v = ed.form.values;
    const set = ed.form.set;
    return (
        <>
            <DetailSection title={s.sectionImage}>
                {ed.photo.canUpload ? (
                    <View style={{ gap: 12 }}>
                        <ImagePicker
                            src={mediaUrl(apiBaseUrl, ed.photo.fileId)}
                            name={v.name}
                            label={ed.photo.fileId === null ? s.photo : s.changePhoto}
                            hint={s.photoHint}
                            busy={ed.photo.busy || picker.busy}
                            onPick={pick}
                        />
                        {ed.photo.error || picker.error ? (
                            <Notice tone="danger">{ed.photo.error ?? picker.error}</Notice>
                        ) : null}
                        {ed.photo.uploaded ? (
                            <Notice tone="success">{s.photoUploaded}</Notice>
                        ) : null}
                    </View>
                ) : (
                    <Text style={styles.hint}>{s.photoAfterSave}</Text>
                )}
            </DetailSection>
            <DetailSection title={s.sectionBasics}>
                <BasicsFields form={ed.form} placeholder={s.namePlaceholderProduct(word)} />
                <TextField
                    label={s.sku}
                    hint={s.skuHint}
                    value={v.sku}
                    onChange={(x) => {
                        set("sku", x);
                    }}
                />
            </DetailSection>
            <DetailSection title={s.sectionPrice}>
                <View style={styles.pair}>
                    <Num
                        label={s.price}
                        {...currencyAffix(BUSINESS_CURRENCY)}
                        value={v.price}
                        onChange={(x) => {
                            set("price", x);
                        }}
                    />
                    <Num
                        label={s.cost}
                        {...currencyAffix(BUSINESS_CURRENCY)}
                        value={v.cost}
                        onChange={(x) => {
                            set("cost", x);
                        }}
                    />
                </View>
                <View style={[styles.margin, ed.margin?.low === true && styles.marginLow]}>
                    <Text style={styles.hintInline}>{s.margin}</Text>
                    <Text style={styles.marginValue}>
                        {ed.margin === null ? s.marginUnknown : ed.margin.label}
                    </Text>
                </View>
                {ed.margin?.warning != null ? (
                    <Text style={styles.warn}>{ed.margin.warning}</Text>
                ) : null}
                <Text style={styles.hint}>{s.costHint}</Text>
            </DetailSection>
            {ed.addsToVisit ? (
                <DetailSection title={s.sectionVisit}>
                    <Num
                        label={s.addsToVisit}
                        hint={s.addsToVisitHint}
                        value={v.duration}
                        onChange={(x) => {
                            set("duration", x);
                        }}
                    />
                </DetailSection>
            ) : null}
            <DetailSection title={s.sectionStock}>
                <Toggle
                    label={s.trackStock}
                    hint={s.trackStockHint}
                    value={v.trackStock}
                    onChange={(x) => {
                        set("trackStock", x);
                    }}
                />
                {v.trackStock ? (
                    <View style={styles.pair}>
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
                    </View>
                ) : null}
                {ed.sold30 > 0 ? <Text style={styles.hint}>{s.sold30(ed.sold30)}</Text> : null}
            </DetailSection>
            <DetailSection title={s.sectionShop}>
                <SearchSelect
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
            </DetailSection>
            <DetailSection title={s.sectionPlan}>
                {v.kind === "package" ? (
                    <>
                        <Text style={styles.label}>{s.covers}</Text>
                        <Choice
                            label={s.covers}
                            options={ed.coverOptions}
                            value={v.coversItemId === "" ? null : v.coversItemId}
                            onChange={(x) => {
                                set("coversItemId", x);
                            }}
                        />
                        <Text style={styles.hint}>{s.coversHint}</Text>
                        <View style={styles.pair}>
                            <Num
                                label={s.visitsLabel}
                                value={v.sessionCount}
                                onChange={(x) => {
                                    set("sessionCount", x);
                                }}
                            />
                            <Num
                                label={s.price}
                                {...currencyAffix(BUSINESS_CURRENCY)}
                                value={v.price}
                                onChange={(x) => {
                                    set("price", x);
                                }}
                            />
                        </View>
                        <Num
                            label={s.validForDays}
                            hint={s.noExpiryHint}
                            value={v.validityDays}
                            onChange={(x) => {
                                set("validityDays", x);
                            }}
                        />
                    </>
                ) : null}
                {v.kind === "subscription" ? (
                    <>
                        <Num
                            label={s.price}
                            {...currencyAffix(BUSINESS_CURRENCY)}
                            value={v.price}
                            onChange={(x) => {
                                set("price", x);
                            }}
                        />
                        <Text style={styles.label}>{s.billsEvery}</Text>
                        <Choice
                            label={s.billsEvery}
                            options={FREQUENCIES.map((f) => ({ key: f.value, label: f.label }))}
                            value={v.frequency}
                            onChange={(x) => {
                                set("frequency", x);
                            }}
                        />
                        <Text style={styles.label}>{s.membershipCovers}</Text>
                        <Choice
                            label={s.membershipCovers}
                            options={ed.membershipCover.options}
                            value={ed.membershipCover.value}
                            onChange={ed.membershipCover.choose}
                        />
                        <View style={styles.pair}>
                            <Num
                                label={s.includes}
                                value={v.visitsPerPeriod}
                                onChange={(x) => {
                                    set("visitsPerPeriod", x);
                                }}
                            />
                            <Num
                                label={s.memberPerk}
                                value={v.memberDiscount}
                                onChange={(x) => {
                                    set("memberDiscount", x);
                                }}
                            />
                        </View>
                        <Text style={styles.hint}>{s.includesHint}</Text>
                    </>
                ) : null}
                {v.kind === "gift" ? (
                    <>
                        <Text style={styles.label}>{s.giftAmounts}</Text>
                        <Choice
                            label={s.giftAmounts}
                            options={ed.giftChoices.map((g) => ({
                                key: String(g),
                                label: formatMoney(g, BUSINESS_CURRENCY),
                            }))}
                            value={v.giftAmounts.map(String)}
                            onChange={(k) => {
                                ed.toggleGiftAmount(Number(k));
                            }}
                        />
                        <Text style={styles.hint}>{s.giftAmountsHint}</Text>
                    </>
                ) : null}
            </DetailSection>
            <View style={styles.planFacts}>
                <Text style={styles.name}>{ed.facts.summary}</Text>
                {ed.facts.perVisit !== null ? (
                    <Text style={styles.facts}>{ed.facts.perVisit}</Text>
                ) : null}
                {ed.facts.perYear !== null ? (
                    <Text style={styles.facts}>{ed.facts.perYear}</Text>
                ) : null}
                {ed.facts.priceNote !== null ? (
                    <Text style={styles.hint}>{ed.facts.priceNote}</Text>
                ) : null}
                <Text style={styles.hint}>{s.sellsAt}</Text>
            </View>
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
            title={item?.name ?? s.newItem(kind)}
            subtitle={kindLabel}
            status={archived ? { status: s.archived, intent: "neutral" } : undefined}
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
                        {item === null ? s.add : s.save}
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

interface EditorProps {
    item: ItemRow | null;
    kind: string;
    items: readonly ItemRow[];
    onClose: () => void;
}

function ServiceSheet({ item, kind, onClose }: EditorProps) {
    const ed = useServiceEditor(api, item, kind, onClose);
    return (
        <Frame item={item} kind={kind} form={ed.form} onClose={onClose}>
            <ServiceFields ed={ed} />
        </Frame>
    );
}

function ProductSheet({ item, onClose }: EditorProps) {
    const ed = useProductEditor(api, item, onClose);
    return (
        <Frame item={item} kind="product" form={ed.form} onClose={onClose}>
            <ProductFields ed={ed} />
        </Frame>
    );
}

function PlanSheet({ item, kind, items, onClose }: EditorProps) {
    const ed = usePlanEditor(api, item, kind, items, onClose);
    return (
        <Frame item={item} kind={kind} form={ed.form} onClose={onClose}>
            <PlanFields ed={ed} />
        </Frame>
    );
}

/** The item editor in a sheet, with the fields that kind of item uses. */
export function ItemEditor(props: EditorProps) {
    if (props.kind === "service" || props.kind === "class") return <ServiceSheet {...props} />;
    if (props.kind === "product") return <ProductSheet {...props} />;
    return <PlanSheet {...props} />;
}

const styles = StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    gap: { gap: 8, marginTop: 6 },
    pair: { flexDirection: "row", gap: 10 },
    bar: { marginTop: 12 },
    name: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15.5, fontWeight: "600" },
    facts: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14, marginTop: 2 },
    hint: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 12.5,
        marginTop: 6,
        lineHeight: 17,
    },
    hintInline: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    warn: { color: c.warnFg, fontFamily: theme.fonts.ui, fontSize: 12.5, marginTop: 6 },
    label: {
        color: c.inkSoft,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontWeight: "600",
        marginTop: 14,
        marginBottom: 6,
    },
    summary: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 13.5,
        backgroundColor: c.bg,
        padding: 10,
        borderRadius: theme.radius,
        overflow: "hidden",
        lineHeight: 19,
    },
    summaryOn: { color: c.okFg, backgroundColor: c.okBg },
    margin: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
        padding: 10,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
    },
    marginLow: { backgroundColor: c.warnBg },
    marginValue: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    planFacts: {
        marginTop: 16,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.accentLine,
        backgroundColor: c.accentWeak,
        gap: 2,
    },
});
