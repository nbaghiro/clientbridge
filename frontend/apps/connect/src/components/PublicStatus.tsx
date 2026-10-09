import { type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Avatar, Button, Empty, Icon, Logo } from "@clientbridge/ui";
import type { ReactNode } from "react";

import { isEmbedded } from "../embed";
import { brandStyle } from "./PublicPage";
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
    const loading = kind === "loading";
    const logo = brand?.avatar_url ?? brand?.logo_url;
    return (
        <main
            style={brandStyle(brand)}
            className={`flex flex-col items-center justify-center gap-6 px-4 py-10 ${isEmbedded() ? "min-h-64" : "min-h-dvh bg-bg"}`}
        >
            <div className={loading ? "motion-safe:animate-pulse" : undefined}>
                {logo ? (
                    <Avatar src={logo} name="" size="lg" />
                ) : (
                    <Logo className="h-12 w-auto text-accent" />
                )}
            </div>
            {loading ? (
                <p role="status" className="sr-only">
                    {strings.common.loading}
                </p>
            ) : (
                <Empty
                    className="w-full max-w-md rounded-xl border border-line bg-surface shadow-card"
                    icon={kind === "notFound" ? "search" : "cloudOff"}
                    intent={kind === "error" ? "danger" : "neutral"}
                    message={title ?? strings.common.somethingWrong}
                    body={body ?? strings.common.tryAgainLater}
                    actions={
                        kind === "error" && onRetry !== undefined ? (
                            <Button icon="refresh" onPress={onRetry}>
                                {strings.ui.retry}
                            </Button>
                        ) : undefined
                    }
                />
            )}
        </main>
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
                <Icon
                    name={closed ? "minus" : "check"}
                    size={32}
                    className={`mx-auto block ${closed ? "text-muted" : "text-ink-soft"}`}
                />
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
