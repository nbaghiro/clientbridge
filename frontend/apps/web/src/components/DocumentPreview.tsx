import { type PrintedDoc, type PrintedKind, strings } from "@clientbridge/app-core";
import {
    Button,
    Choice,
    Empty,
    Icon,
    IconButton,
    KeyValueList,
    Modal,
    Notice,
    PrintedDocument,
} from "@clientbridge/ui";
import { useState } from "react";

const d = strings.billing.doc;

export interface PreviewDoc {
    kind: PrintedKind;
    doc: PrintedDoc | null;
    missing: string;
    attached: string;
    facts: { label: string; value: string }[];
}

/** The letterhead page staff see from a record; Print and Download use the browser's print dialog. */
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
    const [kind, setKind] = useState<PrintedKind>(initial);
    const current = docs.find((x) => x.kind === kind) ?? docs[0];
    const doc = current?.doc ?? null;
    const fileName = doc === null ? "" : d.fileName(businessName, d.kinds[kind], doc.number);
    const print = (): void => {
        const before = document.title;
        document.title = fileName.replace(/\.pdf$/, "");
        window.print();
        document.title = before;
    };

    return (
        <Modal onClose={onClose} size="xl" framed={false}>
            <div className="flex h-[92vh] flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-card">
                <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
                    <Button variant="quiet" icon="chevronLeft" onPress={onClose}>
                        {d.back}
                    </Button>
                    <Choice<PrintedKind>
                        layout="segmented"
                        label={d.title}
                        options={docs.map((x) => ({ key: x.kind, label: d.kinds[x.kind] }))}
                        value={kind}
                        onChange={setKind}
                    />
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            variant="quiet"
                            icon="printer"
                            disabled={doc === null}
                            onPress={print}
                        >
                            {d.print}
                        </Button>
                        <Button icon="receipt" disabled={doc === null} onPress={print}>
                            {d.download}
                        </Button>
                        <IconButton icon="x" label={strings.common.close} onPress={onClose} />
                    </div>
                </header>
                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
                    <div className="min-h-0 overflow-y-auto px-6 py-8">
                        {doc === null ? (
                            <Empty variant="card" icon="receipt" message={current?.missing ?? ""} />
                        ) : (
                            <div className="print-area mx-auto max-w-[44rem]">
                                <PrintedDocument doc={doc} />
                            </div>
                        )}
                    </div>
                    <aside className="hidden min-h-0 space-y-5 overflow-y-auto border-l border-line bg-surface px-5 py-6 lg:block">
                        {doc !== null ? (
                            <>
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-bg text-danger">
                                        <Icon name="receipt" size={18} />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-ink">
                                            {fileName}
                                        </p>
                                        <p className="text-xs text-muted">{d.pages}</p>
                                    </div>
                                </div>
                                <KeyValueList rows={current?.facts ?? []} layout="inline" />
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                                        {d.attachedTo}
                                    </p>
                                    <p className="mt-1 flex items-start gap-2 text-sm text-ink">
                                        <Icon name="mail" size={16} />
                                        {current?.attached}
                                    </p>
                                </div>
                                <p className="text-xs text-muted">{doc.business.registration}</p>
                                <Notice tone="info">{d.downloadHint}</Notice>
                            </>
                        ) : null}
                    </aside>
                </div>
            </div>
        </Modal>
    );
}
