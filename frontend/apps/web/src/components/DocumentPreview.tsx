import { type PrintedDoc, type PrintedKind, strings } from "@clientbridge/app-core";
import { Button, Choice, Empty, Icon, IconButton, Modal, PrintedDocument } from "@clientbridge/ui";
import { type ReactNode, useState } from "react";

const d = strings.billing.doc;

export interface PreviewDoc {
    kind: PrintedKind;
    doc: PrintedDoc | null;
    missing: string;
    attached: string;
}

/** A document set as paper on a dotted backdrop, with its actions in a bar beneath it. */
export function PaperPane({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-bg">
            <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,var(--color-line)_1px,transparent_0)] [background-size:18px_18px] px-10 py-8">
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
        <div className="print-area mx-auto max-w-[44rem] rounded-md bg-surface shadow-xl ring-1 ring-line">
            <PrintedDocument doc={doc} />
        </div>
    );
}

/** A record's letterhead pages: switch between them, print, or save one as PDF. */
export function DocumentPane({
    docs,
    initial,
    businessName,
}: {
    docs: readonly PreviewDoc[];
    initial: PrintedKind;
    businessName: string;
}) {
    const [kind, setKind] = useState<PrintedKind>(initial);
    const current = docs.find((x) => x.kind === kind) ?? docs[0];
    const doc = current?.doc ?? null;
    const print = (): void => {
        if (doc === null) return;
        const before = document.title;
        document.title = d
            .fileName(businessName.replace(/[^A-Za-z0-9]+/g, "-"), d.kinds[kind], doc.number)
            .replace(/\.pdf$/, "");
        window.print();
        document.title = before;
    };
    return (
        <PaperPane
            bar={
                <>
                    {docs.length > 1 ? (
                        <Choice<PrintedKind>
                            layout="segmented"
                            label={d.title}
                            options={docs.map((x) => ({ key: x.kind, label: d.kinds[x.kind] }))}
                            value={kind}
                            onChange={setKind}
                        />
                    ) : null}
                    {doc !== null && current?.attached ? (
                        <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
                            <Icon name="mail" size={15} />
                            <span className="truncate">{current.attached}</span>
                        </p>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            variant="outline"
                            icon="printer"
                            disabled={doc === null}
                            onPress={print}
                        >
                            {d.print}
                        </Button>
                        <Button icon="receipt" disabled={doc === null} onPress={print}>
                            {d.download}
                        </Button>
                    </div>
                </>
            }
        >
            {doc === null ? (
                <div className="mx-auto max-w-md pt-16">
                    <Empty variant="card" icon="receipt" message={current?.missing ?? ""} />
                </div>
            ) : (
                <Paper doc={doc} />
            )}
        </PaperPane>
    );
}

/** The same pages full screen, for a window too narrow to show them beside the record. */
export function DocumentPreview({
    docs,
    initial,
    businessName,
    onClose,
}: {
    docs: readonly PreviewDoc[];
    initial: PrintedKind;
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
                    <DocumentPane docs={docs} initial={initial} businessName={businessName} />
                </div>
            </div>
        </Modal>
    );
}
