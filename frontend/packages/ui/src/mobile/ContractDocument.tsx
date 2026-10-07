import type { ContractDocumentProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Platform, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";
import { SignaturePad } from "./SignaturePad";

const c = theme.colors;
const SCRIPT = Platform.select({ ios: "Snell Roundhand", android: "cursive", default: "cursive" });

export function ContractDocument({
    issuer,
    title,
    meta,
    clauses,
    signature,
    density = "regular",
    style,
}: NativeProps<ContractDocumentProps>) {
    const compact = density === "compact";
    const body = compact ? styles.bodySmall : styles.body;
    return (
        <View style={[styles.page, compact && styles.pageSmall, style]}>
            <View style={styles.head}>
                <Text style={styles.issuer}>{issuer.toUpperCase()}</Text>
                <Text
                    style={[styles.title, compact && styles.titleSmall]}
                    accessibilityRole="header"
                >
                    {title}
                </Text>
                <Text style={styles.meta}>{meta}</Text>
            </View>
            {clauses.map((cl, i) => (
                <View key={`${String(i)}:${cl.heading}`} style={styles.clause}>
                    {cl.heading !== "" ? (
                        <Text style={[body, styles.heading]}>{cl.heading}</Text>
                    ) : null}
                    {cl.text !== "" ? <Text style={[body, styles.text]}>{cl.text}</Text> : null}
                </View>
            ))}
            {signature ? (
                <View style={[styles.sig, clauses.length === 0 && styles.sigOnly]}>
                    <Text style={styles.issuer}>{signature.heading.toUpperCase()}</Text>
                    {signature.strokes ? (
                        <SignaturePad
                            strokes={signature.strokes}
                            label={signature.name}
                            height={64}
                        />
                    ) : (
                        <Text accessibilityLabel={signature.name} style={styles.script}>
                            {signature.name}
                        </Text>
                    )}
                    <Text style={styles.signer}>{signature.name}</Text>
                    {signature.facts.map((f) => (
                        <View key={f.label} style={styles.fact}>
                            <Text style={styles.factLabel}>{f.label}</Text>
                            <Text style={styles.factValue}>{f.value}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 20,
    },
    pageSmall: { padding: 16 },
    head: { borderBottomWidth: 1, borderColor: c.border, paddingBottom: 12, marginBottom: 6 },
    issuer: { color: c.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
    title: { color: c.ink, fontSize: 19, fontWeight: "700", marginTop: 4 },
    titleSmall: { fontSize: 16 },
    meta: { color: c.muted, fontSize: 12, marginTop: 2 },
    clause: { marginTop: 10 },
    body: { fontSize: 14, lineHeight: 20 },
    bodySmall: { fontSize: 12.5, lineHeight: 18 },
    heading: { color: c.ink, fontWeight: "600" },
    text: { color: c.inkSoft, marginTop: 2 },
    sigOnly: { marginTop: 6, paddingTop: 0, borderTopWidth: 0 },
    sig: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: c.border, gap: 4 },
    script: {
        fontFamily: SCRIPT,
        fontSize: 30,
        color: c.ink,
        height: 64,
        textAlignVertical: "bottom",
        paddingTop: 18,
    },
    signer: {
        color: c.ink,
        fontSize: 14,
        fontWeight: "600",
        borderTopWidth: 1,
        borderColor: c.inkSoft,
        paddingTop: 4,
        marginBottom: 6,
    },
    fact: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 2 },
    factLabel: { color: c.muted, fontSize: 12 },
    factValue: { color: c.inkSoft, fontSize: 12, fontVariant: ["tabular-nums"] },
});
