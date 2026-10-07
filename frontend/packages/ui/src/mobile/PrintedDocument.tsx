import { type PrintedDocumentProps, formatMoney } from "@clientbridge/app-core";
import { ON_DATA, SHADOW, tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { DocTotals } from "./DocTotals";
import { PayCode } from "./PayCode";
import type { NativeProps } from "./props";

const c = theme.colors;
type Doc = PrintedDocumentProps["doc"];

function Brand({ doc, inverse = false }: { doc: Doc; inverse?: boolean }) {
    const b = doc.business;
    return (
        <View style={styles.brand}>
            <View style={[styles.mark, { backgroundColor: inverse ? c.surface : b.brandColor }]}>
                <Text style={[styles.markText, { color: inverse ? b.brandColor : ON_DATA }]}>
                    {b.initials}
                </Text>
            </View>
            <View style={styles.flex}>
                <Text style={[styles.bizName, inverse && styles.inverse]}>{b.name}</Text>
                <Text style={[styles.small, inverse && styles.inverseSoft]}>{b.tagline}</Text>
            </View>
        </View>
    );
}

function Parties({ doc }: { doc: Doc }) {
    const b = doc.business;
    return (
        <View style={styles.parties}>
            <View style={styles.flex}>
                <Text style={styles.cap}>{doc.labels.from}</Text>
                <Text style={styles.strong}>{b.name}</Text>
                {b.address.map((l) => (
                    <Text key={l} style={styles.body}>
                        {l}
                    </Text>
                ))}
                <Text style={styles.body}>{[b.phone, b.email].filter(Boolean).join(" · ")}</Text>
            </View>
            <View style={styles.flex}>
                <Text style={styles.cap}>{doc.partyLabel}</Text>
                <Text style={styles.strong}>{doc.partyName}</Text>
                {doc.partyLines.map((l) => (
                    <Text key={l} style={styles.body} numberOfLines={1}>
                        {l}
                    </Text>
                ))}
            </View>
        </View>
    );
}

function Meta({ doc }: { doc: Doc }) {
    return (
        <View style={styles.meta}>
            {doc.meta.map((m) => (
                <View key={m.label} style={styles.flex}>
                    <Text style={styles.cap}>{m.label}</Text>
                    <Text style={styles.strong}>{m.value}</Text>
                </View>
            ))}
        </View>
    );
}

function Lines({ doc }: { doc: Doc }) {
    const l = doc.labels;
    return (
        <View>
            <View style={[styles.lineRow, styles.lineHead]}>
                <Text style={[styles.cap, styles.flex]}>{l.item}</Text>
                <Text style={[styles.cap, styles.taxCol]}>{l.tax}</Text>
                <Text style={[styles.cap, styles.amountCol]}>{l.amount}</Text>
            </View>
            {doc.lines.map((line) => (
                <View key={line.id} style={styles.lineRow}>
                    <View style={styles.flex}>
                        <Text style={styles.strong}>{line.description}</Text>
                        <Text style={styles.small}>
                            {[
                                line.subject !== null ? l.forPet(line.subject) : null,
                                `${String(line.quantity)} × ${formatMoney(line.unitCents)}`,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </Text>
                    </View>
                    <Text style={[styles.body, styles.taxCol]}>{line.taxCodes.join(" + ")}</Text>
                    <Text style={[styles.strong, styles.amountCol]}>
                        {formatMoney(line.amountCents)}
                    </Text>
                </View>
            ))}
        </View>
    );
}

export function PrintedDocument({
    doc,
    template = "classic",
    style,
}: NativeProps<PrintedDocumentProps>) {
    const statement = template === "statement";
    return (
        <View style={[styles.paper, style]} accessibilityLabel={`${doc.title} ${doc.number}`}>
            {statement ? (
                <View style={[styles.band, { backgroundColor: doc.business.brandColor }]}>
                    <Brand doc={doc} inverse />
                    <Text style={[styles.bandTitle, styles.inverse]}>
                        {doc.title} {/^\d/.test(doc.number) ? "#" : ""}
                        {doc.number}
                    </Text>
                </View>
            ) : (
                <>
                    <View style={styles.headRow}>
                        <Brand doc={doc} />
                        <View style={styles.right}>
                            <Text style={[styles.title, { color: doc.business.brandColor }]}>
                                {doc.title.toUpperCase()}
                            </Text>
                            <Text style={styles.small}>
                                {/^\d/.test(doc.number) ? "#" : ""}
                                {doc.number}
                            </Text>
                        </View>
                    </View>
                    <View style={[styles.rule, { backgroundColor: doc.business.brandColor }]} />
                </>
            )}

            {statement ? (
                <View style={styles.headline}>
                    <View style={styles.flex}>
                        <Text style={styles.cap}>{doc.headline.label}</Text>
                        <Text style={styles.big}>{formatMoney(doc.headline.cents)}</Text>
                        <Text style={styles.small}>
                            {doc.meta[2]?.label} {doc.meta[2]?.value}
                        </Text>
                    </View>
                    {doc.payUrl !== null ? (
                        <PayCode value={doc.payUrl} size={64} label={doc.labels.scanToPay} />
                    ) : null}
                </View>
            ) : null}

            <Parties doc={doc} />
            <Meta doc={doc} />
            {doc.message !== null ? <Text style={styles.message}>{doc.message}</Text> : null}
            <Lines doc={doc} />
            <View style={styles.totals}>
                <DocTotals lines={doc.totals} density="compact" />
                {doc.stamp !== null ? (
                    <View style={styles.stamp}>
                        <Text style={styles.stampText}>{doc.stamp.toUpperCase()}</Text>
                    </View>
                ) : null}
            </View>
            {doc.payment !== null ? (
                <View style={styles.box}>
                    <Text style={styles.cap}>{doc.labels.paymentMethod}</Text>
                    <Text style={styles.strong}>
                        {doc.payment.method}
                        {doc.payment.reference ? ` · ${doc.payment.reference}` : ""}
                    </Text>
                    <Text style={styles.small}>{doc.payment.at}</Text>
                </View>
            ) : null}
            {!statement && doc.instructions.length > 0 ? (
                <View style={[styles.box, styles.payRow]}>
                    <View style={styles.flex}>
                        <Text style={styles.cap}>{doc.labels.howToPay}</Text>
                        {doc.instructions.map((i) => (
                            <Text key={i} style={styles.body}>
                                {i}
                            </Text>
                        ))}
                    </View>
                    {doc.payUrl !== null ? (
                        <PayCode value={doc.payUrl} size={52} label={doc.labels.scanToPay} />
                    ) : null}
                </View>
            ) : null}
            <View style={styles.footer}>
                <Text style={styles.small}>{doc.footer}</Text>
                <Text style={styles.tiny}>{doc.business.registration}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    paper: {
        backgroundColor: c.surface,
        borderRadius: 4,
        padding: 18,
        overflow: "hidden",
        shadowColor: SHADOW,
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
    },
    flex: { flex: 1, minWidth: 0 },
    brand: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
    mark: {
        width: 28,
        height: 28,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    markText: { fontSize: 11, fontWeight: "800" },
    bizName: { color: c.ink, fontSize: 12, fontWeight: "700" },
    inverse: { color: ON_DATA },
    inverseSoft: { color: tintHex(ON_DATA, 75) },
    headRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
    },
    right: { alignItems: "flex-end" },
    title: { fontSize: 15, fontWeight: "800", letterSpacing: 2 },
    rule: { height: 2, borderRadius: 1, marginTop: 12, marginBottom: 14 },
    band: {
        marginHorizontal: -18,
        marginTop: -18,
        paddingHorizontal: 18,
        paddingVertical: 14,
        gap: 8,
        marginBottom: 14,
    },
    bandTitle: { fontSize: 13, fontWeight: "700" },
    headline: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        backgroundColor: c.bg,
        marginBottom: 14,
    },
    big: {
        color: c.ink,
        fontSize: 24,
        fontWeight: "800",
        fontVariant: ["tabular-nums"],
        marginVertical: 2,
    },
    parties: { flexDirection: "row", gap: 12 },
    meta: {
        flexDirection: "row",
        gap: 8,
        marginTop: 12,
        paddingVertical: 8,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: c.borderSoft,
    },
    cap: {
        color: c.muted,
        fontSize: 8.5,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 2,
    },
    strong: { color: c.ink, fontSize: 10.5, fontWeight: "600" },
    body: { color: c.inkSoft, fontSize: 10, lineHeight: 14 },
    small: { color: c.muted, fontSize: 9.5, lineHeight: 13 },
    tiny: { color: c.muted, fontSize: 8.5, marginTop: 2 },
    message: {
        color: c.inkSoft,
        fontSize: 10,
        lineHeight: 14,
        backgroundColor: c.bg,
        padding: 8,
        borderRadius: 6,
        marginTop: 12,
    },
    lineHead: { borderBottomColor: c.ink, borderBottomWidth: 1, marginTop: 14, paddingBottom: 4 },
    lineRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: 6,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    taxCol: { width: 46 },
    amountCol: { width: 58, textAlign: "right" },
    totals: { marginTop: 8, marginLeft: 70 },
    box: { borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 10, marginTop: 12 },
    payRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    stamp: {
        pointerEvents: "none",
        alignSelf: "center",
        marginTop: 12,
        borderWidth: 2.5,
        borderColor: c.success,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 2,
        transform: [{ rotate: "-10deg" }],
    },
    stampText: { color: c.success, fontSize: 20, fontWeight: "800", letterSpacing: 3 },
    footer: { marginTop: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border },
});
