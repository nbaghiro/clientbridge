import {
    type PrintedDoc,
    type ReviewDocument,
    printedEstimate,
    printedInvoice,
    strings,
    useEstimateRecord,
    useInvoiceRecord,
    useLetterhead,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Button, Modal, PrintedDocument } from "@clientbridge/ui";

import { apiUrl, payUrl } from "../lib/config";

const c = theme.colors;
const d = strings.billing.doc;

/** The letterhead page on the phone; Share hands the client's link to another app. */
export function DocumentPreview({
    doc,
    shareUrl,
    onClose,
}: {
    doc: PrintedDoc;
    shareUrl: string | null;
    onClose: () => void;
}) {
    return (
        <Modal onClose={onClose} size="xl">
            <Text style={styles.title}>{d.kinds[doc.kind]}</Text>
            <ScrollView style={styles.page}>
                <PrintedDocument doc={doc} />
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
    page: { maxHeight: 520 },
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
