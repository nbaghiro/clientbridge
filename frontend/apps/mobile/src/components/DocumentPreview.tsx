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
import { ScrollView, Share, StyleSheet, View } from "react-native";
import { Button, Modal, OverFlow, PrintedDocument, SheetHeader } from "@clientbridge/ui";

import { apiUrl, payUrl } from "../lib/config";

const c = theme.colors;
const d = strings.billing.doc;

/** The letterhead page as its own sheet; Share hands the client's link to another app. */
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
        <OverFlow>
            <Modal onClose={onClose} size="xl" framed={false}>
                <View style={styles.frame}>
                    <SheetHeader title={d.kinds[doc.kind]} />
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
                </View>
            </Modal>
        </OverFlow>
    );
}

const styles = StyleSheet.create({
    // the footer stays on screen however short the phone, with the page scrolling above it
    frame: { flex: 1, padding: 22, paddingBottom: 36, backgroundColor: c.surface },
    page: { flex: 1, minHeight: 0 },
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
