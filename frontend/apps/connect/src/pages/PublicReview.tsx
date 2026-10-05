import { createPublicReviewClient, strings, usePublicReview } from "@clientbridge/app-core/public";
import { useParams } from "react-router-dom";

import { Button, Notice, Stars, TextField } from "@clientbridge/ui";
import { PublicFrame } from "../components/PublicFrame";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const reviews = createPublicReviewClient(config.apiUrl);

export function PublicReview() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicReview(reviews, token);
    const ctx = form.context;
    useEmbedSuccess(form.status === "done", "review");

    if (form.status === "loading") return <PublicStatus kind="loading" />;

    if (form.status === "not-found")
        return (
            <PublicStatus
                kind="notFound"
                title={strings.publicReview.notFoundTitle}
                body={strings.publicReview.notFoundBody}
            />
        );

    if (form.status === "error" || ctx === null) return <PublicStatus kind="error" />;

    if (form.status === "done")
        return (
            <PublicDone
                brand={ctx.brand}
                title={strings.publicReview.doneTitle}
                body={strings.publicReview.doneBody(ctx.business_name)}
            />
        );

    return (
        <PublicFrame brand={ctx.brand}>
            <p className="text-sm text-muted">{strings.publicReview.prompt(ctx.business_name)}</p>
            <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-ink-soft">
                    {strings.publicReview.ratingLabel}
                </p>
                <Stars value={form.rating} onSelect={form.setRating} size="lg" />
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
