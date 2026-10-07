import {
    type ReviewQueue,
    type ReviewRow,
    firstName,
    formatAverageRating,
    formatDate,
    parseTimestamp,
    reviewState,
    reviewVisitLine,
    roundedRating,
    strings,
    suggestedReply,
    useModeratedReview,
    useRequestReview,
    useReviewQueue,
    useReviewSettings,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Modal,
    Notice,
    Panel,
    RatingDistribution,
    Select,
    Stars,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.reviews;

const dateOf = (value: string): string => formatDate(parseTimestamp(value));

const openExternal = (url: string): void => {
    globalThis.open(url, "_blank", "noopener");
};

export function Reviews() {
    const queue = useReviewQueue();
    const [showHidden, setShowHidden] = useState(false);
    const [asking, setAsking] = useState(false);
    const ask = (): void => {
        setAsking(true);
    };

    return (
        <div>
            <div className="flex items-center justify-between gap-4 pb-5">
                <p className="text-sm text-muted">{s.subtitle}</p>
                <Button icon="send" onPress={ask}>
                    {s.requestReview}
                </Button>
            </div>
            {asking ? (
                <RequestReviewDialog
                    queue={queue}
                    onClose={() => {
                        setAsking(false);
                    }}
                />
            ) : null}
            <Loaded load={queue.load} loading={s.loading} failed={s.loadError}>
                {queue.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="star"
                        message={s.noReviewsTitle}
                        body={s.noReviewsBody}
                        actions={<Button onPress={ask}>{s.requestReview}</Button>}
                    />
                ) : (
                    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
                        <div className="space-y-8">
                            <section aria-labelledby="reviews-held">
                                <div className="mb-3 flex items-center gap-2">
                                    <h2
                                        id="reviews-held"
                                        className="font-display text-base font-bold text-ink"
                                    >
                                        {s.heldTitle}
                                    </h2>
                                    {queue.held.length > 0 ? (
                                        <Badge label={queue.held.length} intent="warning" />
                                    ) : null}
                                </div>
                                {queue.held.length === 0 ? (
                                    <Empty variant="card" message={s.heldEmpty} />
                                ) : (
                                    <div className="space-y-3">
                                        {queue.held.map((r) => (
                                            <ReviewCard key={r.id} review={r} queue={queue} />
                                        ))}
                                    </div>
                                )}
                            </section>
                            <section aria-labelledby="reviews-published">
                                <h2
                                    id="reviews-published"
                                    className="mb-3 font-display text-base font-bold text-ink"
                                >
                                    {s.publishedTitle}
                                </h2>
                                {queue.published.length === 0 ? (
                                    <Empty variant="card" message={s.noPublished} />
                                ) : (
                                    <div className="space-y-3">
                                        {queue.published.map((r) => (
                                            <ReviewCard key={r.id} review={r} queue={queue} />
                                        ))}
                                    </div>
                                )}
                            </section>
                            {queue.hidden.length > 0 ? (
                                <section>
                                    <Button
                                        variant="link"
                                        onPress={() => {
                                            setShowHidden((v) => !v);
                                        }}
                                    >
                                        {showHidden
                                            ? s.hiddenTitle
                                            : s.hiddenLink(queue.hidden.length)}
                                    </Button>
                                    {showHidden ? (
                                        <div className="mt-3 space-y-3">
                                            {queue.hidden.map((r) => (
                                                <ReviewCard
                                                    key={r.id}
                                                    review={r}
                                                    queue={queue}
                                                    showState
                                                />
                                            ))}
                                        </div>
                                    ) : null}
                                </section>
                            ) : null}
                        </div>
                        <aside className="space-y-5 lg:sticky lg:top-6">
                            <Panel>
                                <ReviewSummary queue={queue} />
                            </Panel>
                            <Panel>
                                <AskPanel queue={queue} />
                            </Panel>
                        </aside>
                    </div>
                )}
            </Loaded>
        </div>
    );
}

function ReviewSummary({ queue }: { queue: ReviewQueue }) {
    const settings = useReviewSettings(api, queue);
    return (
        <div className="space-y-4">
            {queue.count > 0 ? (
                <div className="flex items-center gap-4">
                    <div>
                        <div className="font-display text-4xl font-bold text-ink">
                            {formatAverageRating(queue.average)}
                        </div>
                        <Stars value={roundedRating(queue.average)} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <RatingDistribution rows={queue.distribution} label={s.distributionRow} />
                    </div>
                </div>
            ) : null}
            <p className="text-xs text-muted">{s.reviewCount(queue.count)}</p>
            <div className="space-y-4 border-t border-line pt-4">
                <Toggle
                    label={s.holdToggle}
                    hint={s.holdHint}
                    value={settings.holdLow}
                    onChange={settings.setHoldLow}
                />
                <TextField
                    label={s.googleUrl}
                    hint={settings.googleUrl === "" ? s.shareNeedsLink : s.googleUrlHint}
                    value={settings.googleUrl}
                    onChange={settings.setGoogleUrl}
                    onSubmit={settings.saveGoogleUrl}
                    placeholder={s.googleUrlPlaceholder}
                    type="url"
                />
                <div className="flex items-center gap-3">
                    <Button
                        size="sm"
                        variant="outline"
                        busy={settings.busy}
                        onPress={settings.saveGoogleUrl}
                    >
                        {s.saveLink}
                    </Button>
                    {settings.savedGoogle ? (
                        <span className="text-xs text-muted">{s.linkSaved}</span>
                    ) : null}
                </div>
                {settings.error !== null ? <Notice tone="danger">{settings.error}</Notice> : null}
            </div>
        </div>
    );
}

function ReplyEditor({
    review,
    busy,
    onPost,
    onCancel,
}: {
    review: ReviewRow;
    busy: boolean;
    onPost: (text: string) => void;
    onCancel: () => void;
}) {
    const [text, setText] = useState(review.response ?? "");
    const suggestion = review.response === null ? suggestedReply(review) : null;
    return (
        <div className="space-y-2">
            {suggestion !== null && text.length === 0 ? (
                <div className="rounded-md border border-dashed border-accent-line bg-accent-weak/50 px-3 py-2.5">
                    <div className="text-xs font-semibold text-accent-strong">
                        {s.suggestedReply}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{suggestion}</p>
                    <div className="mt-1.5">
                        <Button
                            size="sm"
                            variant="link"
                            onPress={() => {
                                setText(suggestion);
                            }}
                        >
                            {s.useSuggestion}
                        </Button>
                    </div>
                </div>
            ) : null}
            <TextField
                label={s.yourReply}
                multiline
                rows={3}
                value={text}
                onChange={setText}
                placeholder={s.replyPlaceholder}
                autoFocus
            />
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="quiet" onPress={onCancel}>
                    {s.cancel}
                </Button>
                <Button
                    size="sm"
                    busy={busy}
                    disabled={text.trim().length === 0}
                    onPress={() => {
                        onPost(text);
                    }}
                >
                    {s.postReply}
                </Button>
            </div>
        </div>
    );
}

function ReviewCard({
    review,
    queue,
    showState = false,
}: {
    review: ReviewRow;
    queue: ReviewQueue;
    showState?: boolean;
}) {
    const m = useModeratedReview(api, review, openExternal);
    const openLink = useOpenLink();
    const [replying, setReplying] = useState(false);
    const state = reviewState(review);
    const name = review.client_name ?? s.clientFallback;
    const first = firstName(name);

    return (
        <article
            className={`rounded-lg border bg-surface p-5 shadow-card ${m.held ? "border-warn-fg/40" : "border-line"}`}
        >
            <header className="flex items-start gap-3">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{name}</span>
                        <Stars value={review.rating} size="sm" />
                        {showState ? (
                            <StatusPill status={state.label} intent={state.intent} asWritten />
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{reviewVisitLine(review)}</p>
                </div>
                {review.sent_to_google === 1 ? (
                    <Badge label={s.sharedGoogle} intent="neutral" />
                ) : null}
            </header>
            <p
                className={`mt-3 text-sm leading-relaxed ${review.body !== null ? "text-ink" : "italic text-muted"}`}
            >
                {review.body ?? s.noComment}
            </p>
            {review.response !== null && !replying ? (
                <div className="mt-3 border-l-2 border-accent-line pl-3">
                    <div className="text-xs font-semibold text-ink-soft">
                        {s.replied(dateOf(review.responded_at ?? review.created_at))}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{review.response}</p>
                </div>
            ) : null}
            {replying ? (
                <div className="mt-4">
                    <ReplyEditor
                        review={review}
                        busy={m.busy}
                        onPost={(t) => {
                            m.respond(t);
                            setReplying(false);
                        }}
                        onCancel={() => {
                            setReplying(false);
                        }}
                    />
                </div>
            ) : (
                <footer className="mt-4 flex flex-wrap items-center gap-2">
                    {m.held || review.status === "hidden" ? (
                        <Button size="sm" busy={m.busy} onPress={m.publish}>
                            {s.publish}
                        </Button>
                    ) : null}
                    <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                            setReplying(true);
                        }}
                    >
                        {review.response === null ? s.reply : s.editReply}
                    </Button>
                    {m.canShare ? (
                        <Button
                            size="sm"
                            variant="outline"
                            icon="external"
                            busy={m.busy}
                            disabled={queue.googleUrl === null}
                            onPress={m.share}
                        >
                            {s.shareGoogle}
                        </Button>
                    ) : null}
                    {m.held ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                openLink("message", review.client_id);
                            }}
                        >
                            {s.messageClient(first)}
                        </Button>
                    ) : null}
                    {review.status !== "hidden" ? (
                        <span className="ml-auto">
                            <Button size="sm" variant="quiet" busy={m.busy} onPress={m.hide}>
                                {s.hide}
                            </Button>
                        </span>
                    ) : null}
                </footer>
            )}
            {m.error !== null ? (
                <div className="mt-2">
                    <Notice tone="danger">{m.error}</Notice>
                </div>
            ) : null}
        </article>
    );
}

function AskPanel({ queue }: { queue: ReviewQueue }) {
    const req = useRequestReview(api);
    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.askTitle}
                </h3>
                <p className="mt-0.5 text-xs text-muted">{s.askSubtitle}</p>
                {queue.suggestions.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">{s.askEmpty}</p>
                ) : (
                    <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                        {queue.suggestions.map((x) => (
                            <li key={x.clientId} className="flex items-center gap-2.5 px-3 py-2.5">
                                <Avatar name={x.clientName} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-ink">
                                        {x.clientName}
                                    </div>
                                    <div className="truncate text-xs text-muted">{x.visit}</div>
                                </div>
                                {req.sent.has(x.clientId) ? (
                                    <Badge label={s.asked} intent="success" />
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        busy={req.busyId === x.clientId}
                                        onPress={() => {
                                            req.request(x.clientId);
                                        }}
                                    >
                                        {s.ask}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.requestsTitle}
                </h3>
                {queue.requests.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">{s.noRequests}</p>
                ) : (
                    <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                        {queue.requests.map((r) => (
                            <li key={r.id} className="flex items-center gap-2.5 px-3 py-2.5">
                                <Avatar name={r.client_name ?? s.clientFallback} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-ink">
                                        {r.client_name ?? s.clientFallback}
                                    </div>
                                    <div className="truncate text-xs text-muted">
                                        {s.requestedOn(dateOf(r.requested_at))}
                                    </div>
                                </div>
                                <StatusPill
                                    status={s.requestState[r.status] ?? r.status}
                                    intent={r.status === "opened" ? "accent" : "neutral"}
                                    asWritten
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
        </div>
    );
}

function RequestReviewDialog({ queue, onClose }: { queue: ReviewQueue; onClose: () => void }) {
    const req = useRequestReview(api);
    const [clientId, setClientId] = useState(queue.suggestions[0]?.clientId ?? "");
    const name = queue.clientOptions.find((c) => c.key === clientId)?.label ?? "";
    const sent = clientId !== "" && req.sent.has(clientId);
    return (
        <Modal open onClose={onClose}>
            <h2 className="font-display text-lg font-bold text-ink">{s.requestTitle}</h2>
            <p className="mt-1 text-sm text-muted">{s.requestBody}</p>
            <div className="mt-4 space-y-3">
                <Select
                    label={s.requestClient}
                    value={clientId}
                    options={[{ key: "", label: s.chooseClient }, ...queue.clientOptions]}
                    onChange={setClientId}
                />
                {sent ? <Notice tone="success">{s.requestSent(name)}</Notice> : null}
                {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {sent ? s.done : s.cancel}
                    </Button>
                    <Button
                        icon="send"
                        disabled={clientId === "" || sent}
                        busy={req.busyId === clientId}
                        onPress={() => {
                            req.request(clientId);
                        }}
                    >
                        {s.requestSend}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
