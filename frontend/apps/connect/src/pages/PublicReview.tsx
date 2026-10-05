import { createPublicReviewClient, strings, usePublicReview } from "@clientbridge/app-core/public";
import { useParams } from "react-router-dom";

import { Button, Notice, TextField } from "@clientbridge/ui";
import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const reviews = createPublicReviewClient(config.apiUrl);

export function PublicReview() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicReview(reviews, token);
    const ctx = form.context;
    useEmbedSuccess(form.status === "done", "review");

    if (form.status === "loading")
        return (
            <PublicFrame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</PublicFrame>
        );

    if (form.status === "not-found")
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicReview.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicReview.notFoundBody}</p>
            </PublicFrame>
        );

    if (form.status === "error" || ctx === null)
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </PublicFrame>
        );

    if (form.status === "done")
        return (
            <PublicFrame brand={ctx.brand}>
                <div className="py-4 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                        ✓
                    </span>
                    <h1 className="mt-4 font-display text-xl font-bold text-ink">
                        {strings.publicReview.doneTitle}
                    </h1>
                    <p className="mt-2 text-sm text-muted">
                        {strings.publicReview.doneBody(ctx.business_name)}
                    </p>
                </div>
            </PublicFrame>
        );

    return (
        <PublicFrame brand={ctx.brand}>
            <p className="text-sm text-muted">{strings.publicReview.prompt(ctx.business_name)}</p>
            <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-ink-soft">
                    {strings.publicReview.ratingLabel}
                </p>
                <Stars value={form.rating} onSelect={form.setRating} />
            </div>
            <div className="mt-4 space-y-4">
                <TextField
                    multiline
                    rows={4}
                    value={form.body}
                    onChange={form.setBody}
                    placeholder={strings.publicReview.notePlaceholder}
                />
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <Button size="lg" full onPress={form.submit} busy={form.busy}>
                    {form.busy ? strings.publicReview.submitting : strings.publicReview.submit}
                </Button>
            </div>
        </PublicFrame>
    );
}

function Stars({ value, onSelect }: { value: number; onSelect: (n: number) => void }) {
    return (
        <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    onClick={() => {
                        onSelect(n);
                    }}
                    aria-label={strings.publicReview.stars(n)}
                    className={`text-3xl leading-none transition ${
                        n <= value ? "text-accent" : "text-line hover:text-accent-line"
                    }`}
                >
                    ★
                </button>
            ))}
        </div>
    );
}
