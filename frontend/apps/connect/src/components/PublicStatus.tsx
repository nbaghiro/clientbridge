import { type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Button, Loading } from "@clientbridge/ui";
import type { ReactNode } from "react";

import { PublicFrame } from "./PublicFrame";

export function PublicStatus({
    kind,
    title,
    body,
    brand = null,
    onRetry,
}: {
    kind: "loading" | "notFound" | "error";
    title?: string;
    body?: string;
    brand?: PublicBrand | null;
    onRetry?: () => void;
}) {
    if (kind === "loading") {
        return (
            <PublicFrame brand={brand}>
                <Loading />
            </PublicFrame>
        );
    }
    return (
        <PublicFrame brand={brand}>
            <h1 className="font-display text-xl font-bold text-ink">
                {title ?? strings.common.somethingWrong}
            </h1>
            <p className="mt-2 text-sm text-muted">{body ?? strings.common.tryAgainLater}</p>
            {kind === "error" && onRetry !== undefined ? (
                <div className="mt-4">
                    <Button size="sm" variant="outline" icon="refresh" onPress={onRetry}>
                        {strings.ui.retry}
                    </Button>
                </div>
            ) : null}
        </PublicFrame>
    );
}

export function PublicDone({
    brand = null,
    title,
    body,
    closed = false,
    aside,
    children,
}: {
    brand?: PublicBrand | null;
    title: string;
    body: string;
    closed?: boolean;
    aside?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <PublicFrame brand={brand}>
            <div className="py-4 text-center">
                <span
                    aria-hidden
                    className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
                        closed ? "bg-bg text-muted" : "bg-ok-bg text-ok-fg"
                    }`}
                >
                    {closed ? "—" : "✓"}
                </span>
                <div className="mt-4 flex items-center justify-center gap-2">
                    <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
                    {aside}
                </div>
                <p className="mt-2 text-sm text-muted">{body}</p>
                {children !== undefined ? <div className="mt-4">{children}</div> : null}
            </div>
        </PublicFrame>
    );
}
