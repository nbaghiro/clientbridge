import {
    type PrintedDoc,
    type PublicBrand,
    initials,
    strings,
} from "@clientbridge/app-core/public";
import { Button, IconButton, Modal, PrintedDocument } from "@clientbridge/ui";
import { cssVar } from "@clientbridge/tokens";
import type { CSSProperties, ReactNode } from "react";

/** The page around a client's invoice or estimate: the business's name and colour, then the document. */
export function PublicDocument({
    brand,
    businessName,
    contact,
    footer,
    children,
}: {
    brand: PublicBrand;
    businessName: string;
    contact: string | null;
    footer: string;
    children: ReactNode;
}) {
    const color = brand.primary ?? cssVar("accent");
    const style =
        brand.primary !== null ? ({ "--accent": brand.primary } as CSSProperties) : undefined;
    return (
        <div style={style} className="min-h-screen bg-bg">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex items-center gap-3">
                        {brand.logo_url !== null ? (
                            <img src={brand.logo_url} alt="" className="h-9 w-auto" />
                        ) : (
                            <span
                                aria-hidden
                                style={{ backgroundColor: color }}
                                className="flex h-9 w-9 items-center justify-center rounded-md font-display text-sm font-bold text-on-data"
                            >
                                {initials(businessName)}
                            </span>
                        )}
                        <span className="font-display text-base font-bold text-ink">
                            {businessName}
                        </span>
                    </div>
                    {contact !== null ? (
                        <span className="hidden text-sm text-muted sm:block">{contact}</span>
                    ) : null}
                </div>
            </header>
            {children}
            <p className="pb-10 text-center text-xs text-muted">{footer}</p>
        </div>
    );
}

/** A document laid out as its PDF, with the browser's print dialog for saving it. */
export function PrintModal({
    doc,
    printLabel,
    onClose,
}: {
    doc: PrintedDoc;
    printLabel: string;
    onClose: () => void;
}) {
    return (
        <Modal onClose={onClose} size="xl" framed={false}>
            <div className="flex max-h-[92vh] flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-card">
                <div className="flex items-center justify-end gap-2 border-b border-line bg-surface px-4 py-3">
                    <Button
                        icon="printer"
                        onPress={() => {
                            window.print();
                        }}
                    >
                        {printLabel}
                    </Button>
                    <IconButton icon="x" label={strings.common.close} onPress={onClose} />
                </div>
                <div className="overflow-y-auto px-4 py-6">
                    <div className="print-area mx-auto max-w-[44rem]">
                        <PrintedDocument doc={doc} />
                    </div>
                </div>
            </div>
        </Modal>
    );
}
