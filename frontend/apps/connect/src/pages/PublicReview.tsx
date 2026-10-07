import {
    type ReviewPage,
    createPublicReviewClient,
    strings,
    useReviewPage,
} from "@clientbridge/app-core/public";
import { Button, Icon, Notice, Stars, TextField } from "@clientbridge/ui";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const reviews = createPublicReviewClient(config.apiUrl);
const s = strings.publicReview;

export function PublicReview() {
    const { token = "" } = useParams<{ token: string }>();
    const page = useReviewPage(reviews, token);
    const ctx = page.context;
    useEmbedSuccess(page.stage === "thanks-public" || page.stage === "thanks-private", "review");

    if (page.stage === "loading") return <PublicStatus kind="loading" />;
    if (page.stage === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (page.stage === "error" || ctx === null)
        return (
            <PublicStatus
                kind="error"
                title={s.errorTitle}
                body={s.errorBody}
                onRetry={page.retry}
            />
        );
    if (page.stage !== "rate") return <ReviewThanks page={page} />;

    const negative = page.rating > 0 && !page.positive;
    return (
        <PublicFrame brand={ctx.brand}>
            <div className="text-center">
                <p className="text-sm font-semibold text-ink-soft">{ctx.business_name}</p>
                <h1 className="mt-2 font-display text-2xl font-bold text-ink">
                    {ctx.pet !== null ? s.promptPet(ctx.pet) : s.prompt(ctx.business_name)}
                </h1>
                {ctx.service !== null ? (
                    <p className="mt-1 text-sm text-muted">{s.context(ctx.service, ctx.staff)}</p>
                ) : null}
                <div className="mt-5 flex flex-col items-center gap-1.5" aria-label={s.ratingLabel}>
                    <Stars value={page.rating} onSelect={page.setRating} size="lg" />
                    <p className="h-5 text-sm font-medium text-ink-soft" aria-live="polite">
                        {s.ratingWords[page.rating]}
                    </p>
                </div>
            </div>
            <div className="mt-5 space-y-3">
                <TextField
                    label={negative ? s.tellMore : s.tellMoreOptional}
                    multiline
                    rows={4}
                    value={page.body}
                    onChange={page.setBody}
                    placeholder={negative ? s.placeholderNegative : s.placeholderPositive}
                />
                {negative ? (
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                        <Icon name="lock" size={13} />
                        {s.privateNote(ctx.business_name)}
                    </p>
                ) : null}
                {page.error !== null ? <Notice tone="danger">{page.error}</Notice> : null}
                <Button full size="lg" busy={page.busy} onPress={page.submit}>
                    {page.busy ? s.submitting : s.submit}
                </Button>
            </div>
        </PublicFrame>
    );
}

function ReviewThanks({ page }: { page: ReviewPage }) {
    const ctx = page.context;
    const [copied, setCopied] = useState(false);
    const [closed, setClosed] = useState(false);
    if (ctx === null) return null;
    const google = page.stage === "thanks-public" ? ctx.google_review_url : null;
    const text = page.body.trim();
    const body =
        page.stage === "thanks-private"
            ? s.thanksPrivateBody(ctx.business_name)
            : google !== null
              ? s.thanksPublicBody(ctx.business_name)
              : s.thanksGoogleLess(ctx.business_name);

    return (
        <PublicFrame brand={ctx.brand}>
            <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
                    <Icon name={google !== null ? "star" : "check"} size={24} />
                </span>
                <h1 className="mt-4 font-display text-2xl font-bold text-ink">
                    {s.thanksTitle(ctx.first_name)}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
            {google !== null && closed ? (
                <p className="mt-5 text-center text-sm text-muted">{s.closePage}</p>
            ) : null}
            {google !== null && !closed ? (
                <>
                    <figure className="mt-5 rounded-lg border border-line bg-bg px-4 py-3">
                        <Stars value={ctx.rating ?? page.rating} size="sm" />
                        {text !== "" ? (
                            <blockquote className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                                {text}
                            </blockquote>
                        ) : null}
                    </figure>
                    <div className="mt-5 space-y-2">
                        <Button
                            full
                            size="lg"
                            icon="external"
                            onPress={() => {
                                globalThis.open(google, "_blank", "noopener");
                                setClosed(true);
                            }}
                        >
                            {s.postGoogle}
                        </Button>
                        {text !== "" ? (
                            <Button
                                full
                                variant="outline"
                                icon={copied ? "check" : "copy"}
                                onPress={() => {
                                    navigator.clipboard.writeText(text).catch(() => undefined);
                                    setCopied(true);
                                }}
                            >
                                {copied ? s.copied : s.copyReview}
                            </Button>
                        ) : null}
                        <div className="pt-1 text-center">
                            <Button
                                variant="link"
                                onPress={() => {
                                    setClosed(true);
                                }}
                            >
                                {s.noThanks}
                            </Button>
                        </div>
                    </div>
                </>
            ) : null}
        </PublicFrame>
    );
}
