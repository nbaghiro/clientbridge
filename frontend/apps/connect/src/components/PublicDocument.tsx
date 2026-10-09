import { BusinessNavigation } from "./BusinessNavigation";
import { type PrintedDoc, type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Button, IconButton, Modal, PrintedDocument } from "@clientbridge/ui";
import type { ReactNode } from "react";

import { brandStyle, BusinessCover, PoweredBy } from "./PublicPage";

/** The page around a client's invoice or estimate: the business's name and colour, then the document. */
export function PublicDocument({
    brand,
    businessName,
    contact,
    children,
    hero,
    actions,
    width = "wide",
}: {
    brand: PublicBrand;
    businessName: string;
    contact: string | null;
    children: ReactNode;
    hero?: ReactNode;
    actions?: ReactNode;
    width?: "wide" | "narrow";
}) {
    const style = brandStyle(brand);
    const max = width === "narrow" ? "max-w-3xl" : "max-w-6xl";
    return (
        <div style={style} className="flex min-h-screen flex-col bg-bg">
            <BusinessNavigation brand={{ ...brand, business_name: businessName }} />
            <BusinessCover brand={brand}>
                {actions || contact ? (
                    <div
                        className={`mx-auto flex ${max} items-center justify-between gap-4 px-4 py-4 sm:px-6`}
                    >
                        {actions}
                        {contact !== null && actions === undefined ? (
                            <span className="hidden text-sm text-muted sm:block">{contact}</span>
                        ) : null}
                    </div>
                ) : null}
                {hero !== undefined ? (
                    <div className={`mx-auto ${max} px-4 pb-16 pt-3 sm:px-6`}>{hero}</div>
                ) : null}
            </BusinessCover>
            <div className={hero !== undefined ? "relative -mt-10 flex-1" : "flex-1"}>
                {children}
            </div>
            <PoweredBy />
        </div>
    );
}

export function DocumentLetter({
    brand,
    businessName,
    title,
    subtitle,
    actions,
    facts,
    children,
}: {
    brand: PublicBrand;
    businessName: string;
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    facts?: ReactNode;
    children: ReactNode;
}) {
    return (
        <PublicDocument
            brand={brand}
            businessName={businessName}
            contact={null}
            width="narrow"
            hero={
                <>
                    <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                        {title}
                    </h1>
                    {facts}
                    {subtitle ? (
                        <p className="mt-2 max-w-xl text-base text-ink-soft">{subtitle}</p>
                    ) : null}
                </>
            }
        >
            <main className="mx-auto max-w-3xl px-4 sm:px-6">
                <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                    <div className="p-6">{children}</div>
                    {actions !== undefined ? (
                        <footer className="space-y-3 border-t border-line bg-bg/70 px-6 py-6">
                            {actions}
                        </footer>
                    ) : null}
                </article>
            </main>
        </PublicDocument>
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
