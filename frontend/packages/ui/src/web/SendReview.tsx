import {
    type OutgoingPreview,
    type ReviewRequest,
    type ReviewChoice,
    type SendReviewHostProps,
    type SendReviewProps,
    formatPhone,
    registerReviewHost,
    useOutgoingPreview,
    strings,
} from "@clientbridge/app-core/public";
import { useEffect, useState } from "react";

import { Button } from "./Button";
import { MessageBubble } from "./MessageBubble";
import { Modal } from "./Modal";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";

interface Pending {
    request: ReviewRequest;
    resolve: (choice: ReviewChoice | null) => void;
}

/** Mounted once at the app root so review() has somewhere to show what is about to go out. */
export function SendReviewHost({ document }: SendReviewHostProps) {
    const [pending, setPending] = useState<Pending | null>(null);
    useEffect(
        () =>
            registerReviewHost(
                (request) =>
                    new Promise((resolve) => {
                        setPending({ request, resolve });
                    }),
            ),
        [],
    );
    if (pending === null) return null;
    return (
        <SendReview
            request={pending.request}
            document={document}
            onResolve={(choice) => {
                pending.resolve(choice);
                setPending(null);
            }}
        />
    );
}

export function SendReview({ request, document, onResolve }: SendReviewProps) {
    const s = strings.ui.review;
    const preview = useOutgoingPreview(request);
    const page = request.document !== undefined ? document?.(request.document) : undefined;
    return (
        <Modal
            size={page !== undefined ? "xl" : "md"}
            onClose={() => {
                onResolve(null);
            }}
        >
            <div
                className={
                    page !== undefined
                        ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                        : ""
                }
            >
                <div className="space-y-4">
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">{request.title}</h2>
                        {preview.data?.recipient != null ? (
                            <p className="mt-1 text-sm text-muted">
                                {s.to(preview.data.recipient)}
                            </p>
                        ) : null}
                    </div>
                    {request.load === undefined ? null : preview.loading ? (
                        <Skeleton variant="line" count={4} label={s.loading} />
                    ) : preview.failed ? (
                        <div className="space-y-2">
                            <Notice tone="danger" banner>
                                {s.loadFailed}
                            </Notice>
                            <Button variant="link" size="sm" onPress={preview.retry}>
                                {s.retry}
                            </Button>
                        </div>
                    ) : preview.data !== null ? (
                        <Outgoing preview={preview.data} />
                    ) : null}
                    {request.message !== undefined ? (
                        <p className="text-sm text-ink-soft">{request.message}</p>
                    ) : null}
                </div>
                {page !== undefined ? (
                    <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-bg p-4 max-lg:hidden">
                        {page}
                    </div>
                ) : null}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
                <Button
                    variant="quiet"
                    onPress={() => {
                        onResolve(null);
                    }}
                >
                    {strings.common.cancel}
                </Button>
                {request.alternate !== undefined ? (
                    <Button
                        variant="outline"
                        onPress={() => {
                            onResolve("alternate");
                        }}
                    >
                        {request.alternate}
                    </Button>
                ) : null}
                <Button
                    variant={request.destructive === true ? "danger" : "primary"}
                    disabled={preview.loading}
                    onPress={() => {
                        onResolve("confirm");
                    }}
                >
                    {request.confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}

function Outgoing({ preview }: { preview: OutgoingPreview }) {
    const s = strings.ui.review;
    if (preview.text === null)
        return (
            <Notice tone="info" banner>
                {s.nothingSent}
            </Notice>
        );
    return (
        <div className="space-y-3">
            <div className="rounded-lg bg-bg p-4">
                <p className="mb-2 text-xs text-muted">{s.textTo(formatPhone(preview.text.to))}</p>
                <MessageBubble direction="out" width="full" body={preview.text.body} />
            </div>
        </div>
    );
}
