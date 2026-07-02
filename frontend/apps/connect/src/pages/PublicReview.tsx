import { createPublicReviewClient, strings, usePublicReview } from "@clientbridge/app-core/public";
import { useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";

const reviews = createPublicReviewClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "mt-4 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicReview() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicReview(reviews, token);
    const ctx = form.context;

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
            <textarea
                value={form.body}
                onChange={(e) => {
                    form.setBody(e.target.value);
                }}
                placeholder={strings.publicReview.notePlaceholder}
                rows={4}
                className={field}
            />
            {form.error !== null ? (
                <p className="mt-2 text-sm text-danger-fg">{form.error}</p>
            ) : null}
            <button
                type="button"
                onClick={form.submit}
                disabled={form.busy}
                className="mt-4 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
                {form.busy ? strings.publicReview.submitting : strings.publicReview.submit}
            </button>
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
