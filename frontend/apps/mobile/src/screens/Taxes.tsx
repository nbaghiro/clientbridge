import {
    type ItemTaxClass,
    type ProvinceCode,
    FILING_FREQUENCIES,
    PROVINCES,
    TAX_CLASS_KEYS,
    formatDate,
    formatMoney,
    taxableItemPriceLabel,
    strings,
    taxClassLabel,
    exampleSale,
    smallSupplierLimit,
    taxExample,
    useBusinessDay,
    taxExampleTitle,
    useItemTaxClasses,
    useTaxSettingsForm,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Checkbox,
    Choice,
    DateField,
    Empty,
    Field,
    Icon,
    LoadFailed,
    Notice,
    Select,
    Skeleton,
    TextField,
    confirm,
    Panel,
} from "@clientbridge/ui";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.taxes;
const provinceName = (code: string): string => PROVINCES.find((p) => p.code === code)?.name ?? code;

/** Sales tax settings and the tax class of every item, on a phone. */
export function TaxesScreen() {
    const zone = useBusinessZone();
    const form = useTaxSettingsForm(api, provinceName);
    const items = useItemTaxClasses(api);
    const open = useOpenLink();
    const registered = form.registration === "registered";
    const day = useBusinessDay();
    const options = TAX_CLASS_KEYS.map((k) => ({
        key: k,
        label: taxClassLabel(k, form.province, day),
    }));
    const n = items.selected.length;

    if (form.load.state === "error") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <LoadFailed
                        variant="card"
                        message={s.loadError}
                        onRetry={form.load.retry}
                        retrying={form.load.retrying}
                    />
                </View>
            </View>
        );
    }
    if (form.load.state === "loading") {
        return (
            <View style={styles.screen}>
                <View style={styles.content}>
                    <Skeleton variant="line" count={5} label={s.loading} />
                </View>
            </View>
        );
    }
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.small}>{s.subtitle}</Text>
                <Panel>
                    <Field label={s.registeredQ}>
                        <Choice
                            layout="cards"
                            label={s.registeredQ}
                            value={form.registration}
                            onChange={form.setRegistration}
                            options={[
                                { key: "registered", label: s.regYes, hint: s.regYesHint },
                                {
                                    key: "small",
                                    label: s.regSmall(smallSupplierLimit()),
                                    hint: s.regSmallHint,
                                },
                            ]}
                        />
                    </Field>
                    {registered ? null : (
                        <View style={styles.gap}>
                            <Notice tone="info" banner>
                                {s.offNotice}
                            </Notice>
                        </View>
                    )}
                    <View style={styles.province}>
                        <View style={styles.badges}>
                            {form.taxLines.map((l) => (
                                <Badge key={l.label} label={l.label} intent="neutral" />
                            ))}
                        </View>
                        <Select<ProvinceCode>
                            label={s.province}
                            hint={form.provinceLocked ? s.provinceLocked : s.provinceHint}
                            value={form.nextProvince ?? form.province ?? undefined}
                            options={PROVINCES.map((p) => ({ key: p.code, label: p.name }))}
                            onChange={form.setNextProvince}
                            disabled={form.provinceBusy || form.provinceLocked}
                        />
                        {form.provinceError !== null ? (
                            <Notice tone="danger">{form.provinceError}</Notice>
                        ) : null}
                        <Button
                            variant="outline"
                            busy={form.provinceBusy}
                            disabled={!form.provinceChanged}
                            onPress={() => {
                                confirm({
                                    title: s.provinceConfirmTitle(form.nextProvinceName),
                                    message: s.provinceConfirmBody(form.nextProvinceName),
                                    confirmLabel: s.provinceChange,
                                })
                                    .then((ok) => {
                                        if (ok) form.changeProvince();
                                    })
                                    .catch(() => undefined);
                            }}
                        >
                            {s.provinceChange}
                        </Button>
                    </View>
                    <TextField
                        label={s.gst}
                        hint={s.gstHint}
                        value={form.gst}
                        onChange={form.setGst}
                        error={form.fieldErrors.gst}
                        disabled={!registered}
                    />
                    {registered ? (
                        <DateField
                            label={s.registeredSince}
                            hint={s.registeredSinceHint}
                            value={form.registeredSince}
                            onChange={form.setRegisteredSince}
                            zone={zone}
                            optional
                        />
                    ) : null}
                    {form.hasPst ? (
                        <TextField
                            label={s.pst}
                            value={form.pst}
                            onChange={form.setPst}
                            error={form.fieldErrors.pst}
                            disabled={!registered}
                            optional
                        />
                    ) : null}
                    <Select
                        label={s.frequency}
                        value={form.frequency}
                        onChange={form.setFrequency}
                        options={FILING_FREQUENCIES.map((k) => ({ key: k, label: s.freq[k] }))}
                    />
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                    {form.saved ? <Notice tone="success">{s.saved}</Notice> : null}
                    <View style={styles.gap}>
                        <Button full busy={form.busy} disabled={!form.dirty} onPress={form.submit}>
                            {form.busy ? s.saving : s.save}
                        </Button>
                    </View>
                </Panel>

                {registered ? (
                    <Panel style={styles.filing}>
                        <View style={styles.icon}>
                            <Icon name="calendar" size={20} color={c.inkSoft} />
                        </View>
                        <View style={styles.flex}>
                            <Text style={styles.small}>{s.filingTitle}</Text>
                            <Text style={styles.due}>
                                {s.filingDue(formatDate(form.filing.due, zone))}
                            </Text>
                            <Text style={styles.small}>
                                {s.filingPeriod(
                                    formatDate(form.filing.from, zone),
                                    formatDate(form.filing.to, zone),
                                )}
                            </Text>
                            <View style={styles.link}>
                                <Button
                                    size="sm"
                                    variant="link"
                                    onPress={() => {
                                        open("reports");
                                    }}
                                >
                                    {s.openReport}
                                </Button>
                            </View>
                        </View>
                        <View style={styles.right}>
                            <Text style={styles.small}>{s.filingCollected}</Text>
                            <Text style={styles.total}>
                                {formatMoney(form.filing.collectedCents, BUSINESS_CURRENCY)}
                            </Text>
                        </View>
                    </Panel>
                ) : null}

                <Panel title={s.exampleTitle(exampleSale())}>
                    {TAX_CLASS_KEYS.map((cls) => {
                        const ex = taxExample(cls, form.province, registered, day);
                        return (
                            <View key={cls} style={styles.exRow}>
                                <View style={styles.flex}>
                                    <Text style={styles.exLabel}>
                                        {taxExampleTitle(cls, form.province, day)}
                                    </Text>
                                    <Text style={styles.small}>
                                        {ex.lines.length > 0
                                            ? formatParts(
                                                  ex.lines.map(
                                                      (l) =>
                                                          `${l.label} ${formatMoney(l.cents, BUSINESS_CURRENCY)}`,
                                                  ),
                                              )
                                            : s.classes.exempt}
                                    </Text>
                                </View>
                                <Text style={styles.total}>
                                    {formatMoney(ex.totalCents, BUSINESS_CURRENCY)}
                                </Text>
                            </View>
                        );
                    })}
                </Panel>

                <View>
                    <Text style={styles.section}>{s.classesTitle}</Text>
                    <Text style={styles.small}>{s.classesBody}</Text>
                </View>
                {items.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="tag"
                        message={s.noItemsTitle}
                        body={s.noItemsBody}
                        actions={
                            <Button
                                size="sm"
                                icon="plus"
                                onPress={() => {
                                    open("catalog");
                                }}
                            >
                                {s.addItems}
                            </Button>
                        }
                    />
                ) : null}
                {items.items.length > 0 ? (
                    <Panel flush style={styles.flush}>
                        {items.items.map((it, i) => (
                            <View key={it.id} style={[styles.item, i > 0 && styles.divider]}>
                                <Checkbox
                                    label={s.selectItem(it.name)}
                                    hideLabel
                                    value={items.selected.includes(it.id)}
                                    onChange={() => {
                                        items.toggle(it.id);
                                    }}
                                />
                                <View style={styles.flex}>
                                    <Text style={styles.itemName} numberOfLines={1}>
                                        {it.name}
                                    </Text>
                                    <Text style={styles.small}>
                                        {formatParts([
                                            s.kinds[it.kind] ?? it.kind,
                                            taxableItemPriceLabel(it),
                                        ])}
                                    </Text>
                                </View>
                                <Badge
                                    style={{ alignSelf: "center" }}
                                    label={taxClassLabel(it.tax_class, form.province, day)}
                                    intent={it.tax_class === "exempt" ? "neutral" : "accent"}
                                />
                            </View>
                        ))}
                    </Panel>
                ) : null}
                {items.error !== null ? <Notice tone="danger">{items.error}</Notice> : null}
            </ScrollView>
            {n > 0 ? (
                <View style={styles.bulk}>
                    <View style={styles.bulkHead}>
                        <Text style={styles.bulkText}>{formatParts([s.selected(n), s.setTo])}</Text>
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="quiet"
                            onPress={items.clearSelection}
                        >
                            {s.clear}
                        </Button>
                    </View>
                    <Choice<ItemTaxClass>
                        layout="segmented"
                        label={s.setTo}
                        value={null}
                        onChange={(cls) => {
                            items.setClass(items.selected, cls);
                        }}
                        options={options}
                    />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    content: { padding: 16, paddingBottom: 32, gap: 14 },
    flush: { paddingHorizontal: 14 },
    gap: { marginTop: 10 },
    flex: { flex: 1, minWidth: 0 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    province: {
        gap: 10,
        marginTop: 14,
        padding: 12,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
    },
    small: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 17 },
    section: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
        marginTop: 6,
        marginBottom: 2,
    },
    exRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 9,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.borderSoft,
    },
    exLabel: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    total: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 15,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    filing: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    icon: { paddingTop: 2 },
    due: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 17,
        fontWeight: "700",
        marginTop: 1,
    },
    right: { alignItems: "flex-end" },
    link: { marginTop: 6, alignItems: "flex-start" },
    item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    itemName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15, fontWeight: "600" },
    bulk: {
        padding: 14,
        gap: 10,
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
    },
    bulkHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    bulkText: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
});
