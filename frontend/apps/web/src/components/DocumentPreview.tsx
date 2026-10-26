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
import { cssVar } from "@clientbridge/tokens";
import { Button, Icon, IconButton, Modal, PrintedDocument } from "@clientbridge/ui";
import type { ReactNode } from "react";

import { config } from "../config";
import { apiBaseUrl } from "../lib/api";
import { usePrintSheet } from "../lib/print";

const d = strings.billing.doc;

/** A document set as paper on a dotted backdrop, with its actions in a bar beneath it. */
export function PaperPane({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-bg">
            <div
                role="region"
                aria-label={strings.billing.preview}
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-line)_1px,transparent_0)] [background-size:18px_18px] px-10 py-8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
                {children}
            </div>
            {bar !== undefined ? (
                <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line bg-surface px-8 py-3.5">
                    {bar}
                </footer>
            ) : null}
        </div>
    );
}

export function Paper({ doc }: { doc: PrintedDoc }) {
    return (
        <div className="mx-auto max-w-[44rem] rounded-md bg-surface shadow-xl ring-1 ring-line">
            <PrintedDocument doc={doc} />
        </div>
    );
}

/** A record's letterhead page: print it, or save it as PDF. */
export function DocumentPane({
    doc,
    attached,
    businessName,
}: {
    doc: PrintedDoc;
    attached: string;
    businessName: string;
}) {
    const printing = usePrintSheet();
    const print = (): void => {
        printing.print(
            d
                .fileName(
                    businessName.replace(/[^A-Za-z0-9]+/g, "-"),
                    d.kinds[doc.kind],
                    doc.number,
                )
                .replace(/\.pdf$/, ""),
        );
    };
    return (
        <PaperPane
            bar={
                <>
                    {attached !== "" ? (
                        <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
                            <Icon name="mail" size={15} />
                            <span className="truncate">{attached}</span>
                        </p>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="outline" icon="printer" onPress={print}>
                            {d.print}
                        </Button>
                        <Button icon="receipt" onPress={print}>
                            {d.download}
                        </Button>
                    </div>
                </>
            }
        >
            <Paper doc={doc} />
            {printing.sheet(<PrintedDocument doc={doc} />)}
        </PaperPane>
    );
}

/** The same page full screen, for a window too narrow to show it beside the record. */
export function DocumentPreview({
    doc,
    attached,
    businessName,
    onClose,
}: {
    doc: PrintedDoc;
    attached: string;
    businessName: string;
    onClose: () => void;
}) {
    return (
        <Modal onClose={onClose} size="xl" framed={false}>
            <div className="flex h-[92vh] flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-card">
                <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
                    <Button variant="quiet" icon="chevronLeft" onPress={onClose}>
                        {d.back}
                    </Button>
                    <div className="ml-auto">
                        <IconButton icon="x" label={strings.common.close} onPress={onClose} />
                    </div>
                </header>
                <div className="min-h-0 flex-1">
                    <DocumentPane doc={doc} attached={attached} businessName={businessName} />
                </div>
            </div>
        </Modal>
    );
}

/** The invoice or estimate a send is about, as the client will see it. */
export function RecordPaper({ kind, id }: ReviewDocument) {
    const letterhead = useLetterhead(apiBaseUrl);
    const invoice = useInvoiceRecord(kind === "invoice" ? id : null, config.payUrl);
    const estimate = useEstimateRecord(kind === "estimate" ? id : null, config.payUrl);
    const doc =
        invoice !== null
            ? printedInvoice(invoice, letterhead, cssVar("accent"))
            : estimate !== null
              ? printedEstimate(estimate, letterhead, cssVar("accent"))
              : null;
    return doc === null ? null : <PrintedDocument doc={doc} />;
}
