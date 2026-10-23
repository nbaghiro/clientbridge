import {
    type PrintedDoc,
    type PrintedKind,
    type ReviewDocument,
    printedEstimate,
    printedInvoice,
    strings,
    useEstimateRecord,
    useInvoiceRecord,
    useLetterhead,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Button, Choice, Empty, Modal, PrintedDocument } from "@clientbridge/ui";

import { apiUrl, payUrl } from "../lib/config";

const c = theme.colors;
const d = strings.billing.doc;

export interface PreviewDoc {
    kind: PrintedKind;
    doc: PrintedDoc | null;
    missing: string;
}

/** The letterhead page on the phone; Share hands the client's link to another app. */
export function DocumentPreview({
    docs,
    initial,
    shareUrl,
    onClose,
}: {
    docs: readonly PreviewDoc[];
    initial: PrintedKind;
    shareUrl: string | null;
    onClose: () => void;
}) {
    const [kind, setKind] = useState<PrintedKind>(initial);
    const current = docs.find((x) => x.kind === kind) ?? docs[0];
    const doc = current?.doc ?? null;
    return (
        <Modal onClose={onClose} size="xl">
            <Text style={styles.title}>{d.title}</Text>
            {docs.length > 1 ? (
                <Choice<PrintedKind>
                    layout="segmented"
                    label={d.title}
                    options={docs.map((x) => ({ key: x.kind, label: d.kinds[x.kind] }))}
                    value={kind}
                    onChange={setKind}
                />
            ) : null}
            <ScrollView style={styles.page}>
                {doc === null ? (
                    <Empty variant="card" icon="receipt" message={current?.missing ?? ""} />
                ) : (
                    <PrintedDocument doc={doc} />
                )}
            </ScrollView>
            <View style={styles.footer}>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.close}
                </Button>
                {shareUrl !== null ? (
                    <Button
                        grow
                        icon="external"
                        onPress={() => {
                            Share.share({ message: shareUrl }).catch(() => undefined);
                        }}
                    >
                        {d.share}
                    </Button>
                ) : null}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    title: { fontSize: 19, fontWeight: "700", color: c.ink, marginBottom: 12 },
    page: { marginTop: 12, maxHeight: 520 },
    footer: { flexDirection: "row", gap: 10, paddingTop: 12 },
});

/** The invoice or estimate a send is about, as the client will see it. */
export function RecordPaper({ kind, id }: ReviewDocument) {
    const letterhead = useLetterhead(apiUrl);
    const invoice = useInvoiceRecord(kind === "invoice" ? id : null, payUrl);
    const estimate = useEstimateRecord(kind === "estimate" ? id : null, payUrl);
    const doc =
        invoice !== null
            ? printedInvoice(invoice, letterhead, c.accent)
            : estimate !== null
              ? printedEstimate(estimate, letterhead, c.accent)
              : null;
    return doc === null ? null : <PrintedDocument doc={doc} />;
}
