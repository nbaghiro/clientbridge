import {
    type ReviewQueue,
    formatDate,
    parseTimestamp,
    strings,
    useRequestReview,
    useReviewAutomation,
    useReviewQueue,
    useGoogleReviews,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Modal,
    Notice,
    Panel,
    Select,
    SearchSelect,
    Stars,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
const s = strings.reviews;
const dateOf = (value: string, zone: string): string => formatDate(parseTimestamp(value), zone);

export function Reviews() {
    const google = useGoogleReviews(api);
    const queue = useReviewQueue(google.canRequest);
    const automation = useReviewAutomation(api);
    const [asking, setAsking] = useState(false);
    const connect = () => {
        const popup = window.open("about:blank", "google-business", "width=600,height=760");
        google.connect(
            "web",
            (url) => {
                if (popup === null) throw new Error("authorization window blocked");
                popup.location.href = url;
            },
            () => {
                popup?.close();
            },
        );
    };
    return (
        <div className="space-y-5">
            <p className="text-sm text-muted">{s.subtitle}</p>
            {google.loading ? <Notice tone="info">{s.loading}</Notice> : null}
            {google.error !== null ? <Notice tone="danger">{google.error}</Notice> : null}
            {!google.loading && google.error !== null && google.busy === null ? (
                <Button onPress={google.refresh}>{s.retry}</Button>
            ) : null}
            {google.connection?.state === "unavailable" ? (
                <Notice tone="info">{s.unavailable}</Notice>
            ) : null}
            {google.connection?.state === "disconnected" ||
            google.connection?.state === "reconnect_required" ? (
                <Panel>
                    <div className="space-y-3">
                        <h2 className="text-lg font-semibold text-ink">{s.connectTitle}</h2>
                        <p className="text-sm text-muted">
                            {google.connection.state === "reconnect_required"
                                ? s.reconnectBody
                                : s.connectBody}
                        </p>
                        <Button busy={google.busy === "connect"} onPress={connect}>
                            {google.connection.state === "reconnect_required"
                                ? s.reconnect
                                : s.connect}
                        </Button>
                    </div>
                </Panel>
            ) : null}
            {google.busy === "connect" ? (
                <Panel>
                    <p className="mb-3 text-sm text-muted">{s.authorizationWaiting}</p>
                    <Button variant="outline" onPress={google.cancelConnect}>
                        {s.cancel}
                    </Button>
                </Panel>
            ) : null}
            {google.connection?.state === "selecting" ? (
                <Panel>
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-ink">{s.chooseProfile}</h2>
                        <p className="text-sm text-muted">{s.chooseProfileBody}</p>
                        <Select
                            label={s.googleAccount}
                            value={google.account}
                            disabled={google.busy !== null}
                            options={[
                                { key: "", label: s.chooseAccount },
                                ...google.accountOptions,
                            ]}
                            onChange={google.chooseAccount}
                        />
                        {google.accountOptions.length === 0 && !google.loading ? (
                            <Notice tone="info">{s.noAccounts}</Notice>
                        ) : null}
                        {google.moreAccounts ? (
                            <Button
                                variant="outline"
                                busy={google.busy === "accounts"}
                                onPress={google.loadAccounts}
                            >
                                {s.moreAccounts}
                            </Button>
                        ) : null}
                        {google.account !== "" ? (
                            <Select
                                label={s.googleLocation}
                                value={google.location}
                                disabled={google.busy !== null}
                                options={[
                                    { key: "", label: s.chooseLocation },
                                    ...google.locationOptions,
                                ]}
                                onChange={google.setLocation}
                            />
                        ) : null}
                        {google.account !== "" &&
                        google.locationOptions.length === 0 &&
                        google.busy === null ? (
                            <Notice tone="info">{s.noLocations}</Notice>
                        ) : null}
                        {google.moreLocations ? (
                            <Button
                                variant="outline"
                                busy={google.busy === "locations"}
                                onPress={google.loadLocations}
                            >
                                {s.moreLocations}
                            </Button>
                        ) : null}
                        <Button
                            disabled={google.location === "" || google.busy !== null}
                            busy={google.busy === "select"}
                            onPress={google.selectLocation}
                        >
                            {s.useLocation}
                        </Button>
                    </div>
                </Panel>
            ) : null}
            {google.connected ? (
                <>
                    <Panel>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-ink">
                                    {google.connection?.location?.title}
                                </h2>
                                <p className="text-sm text-muted">{google.summary}</p>
                                <p className="text-xs text-muted">{s.attribution}</p>
                            </div>
                            <Button
                                variant="outline"
                                disabled={google.busy !== null}
                                onPress={google.refresh}
                            >
                                {s.refresh}
                            </Button>
                        </div>
                    </Panel>
                    {google.reviews.length === 0 ? (
                        <Notice tone="info">{s.noGoogleReviews}</Notice>
                    ) : null}
                    {google.reviews.map((review) => (
                        <Panel key={review.review_id}>
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="font-semibold text-ink">{review.author}</h3>
                                    <Stars value={review.stars} />
                                </div>
                                <p className="text-xs text-muted">{review.date}</p>
                                {review.comment ? (
                                    <p className="whitespace-pre-wrap text-sm text-ink">
                                        {review.comment}
                                    </p>
                                ) : (
                                    <p className="text-sm text-muted">{s.ratingOnly}</p>
                                )}
                                {review.reply ? (
                                    <div className="rounded-md bg-bg p-3">
                                        <p className="mb-1 text-xs font-semibold text-muted">
                                            {s.ownerReply}
                                        </p>
                                        <p className="whitespace-pre-wrap text-sm text-ink">
                                            {review.reply.comment}
                                        </p>
                                    </div>
                                ) : null}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={google.busy !== null}
                                    onPress={() => {
                                        google.editReply(review);
                                    }}
                                >
                                    {review.reply ? s.editReply : s.reply}
                                </Button>
                            </div>
                        </Panel>
                    ))}
                    {google.moreReviews ? (
                        <Button
                            variant="outline"
                            busy={google.busy === "more"}
                            onPress={google.loadMore}
                        >
                            {s.moreReviews}
                        </Button>
                    ) : null}
                    <Loaded load={queue.load} loading={s.requestsLoading} failed={s.loadError}>
                        <Toggle
                            label={s.automation}
                            hint={s.automationHint}
                            value={automation.enabled}
                            disabled={automation.busy}
                            onChange={automation.setEnabled}
                        />
                        {automation.error !== null ? (
                            <Notice tone="danger">{automation.error}</Notice>
                        ) : null}
                        <Button
                            icon="send"
                            disabled={!google.canRequest}
                            onPress={() => {
                                setAsking(true);
                            }}
                        >
                            {s.requestReview}
                        </Button>
                        {!google.canRequest ? (
                            <Notice tone="info">{s.invitationUnavailable}</Notice>
                        ) : null}
                        <Panel>
                            <AskPanel queue={queue} />
                        </Panel>
                    </Loaded>
                </>
            ) : null}
            {google.connection !== null &&
            !["unavailable", "disconnected"].includes(google.connection.state) ? (
                <Button
                    variant="outline"
                    disabled={google.busy !== null}
                    onPress={() => {
                        google.setConfirm("disconnect");
                    }}
                >
                    {s.disconnect}
                </Button>
            ) : null}
            {google.reply !== null ? (
                <Modal open onClose={google.closeReply}>
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-ink">{s.replyTitle}</h2>
                        <p className="text-sm text-muted">{s.replyPublic}</p>
                        <TextField
                            label={s.replyText}
                            multiline
                            value={google.comment}
                            disabled={google.busy === "reply"}
                            onChange={google.setComment}
                        />
                        {google.error !== null ? (
                            <Notice tone="danger">{google.error}</Notice>
                        ) : null}
                        {google.pendingReply ? <Notice tone="info">{s.replyPending}</Notice> : null}
                        <div className="flex flex-wrap gap-2">
                            <Button
                                busy={google.busy === "reply"}
                                disabled={google.comment.trim() === ""}
                                onPress={google.sendReply}
                            >
                                {s.publishReply}
                            </Button>
                            {google.reply.reply ? (
                                <Button
                                    variant="outline"
                                    disabled={google.busy !== null}
                                    onPress={() => {
                                        google.setConfirm("deleteReply");
                                    }}
                                >
                                    {s.deleteReply}
                                </Button>
                            ) : null}
                            <Button
                                variant="outline"
                                disabled={google.busy === "reply"}
                                onPress={google.closeReply}
                            >
                                {s.cancel}
                            </Button>
                        </div>
                        {google.confirm === "deleteReply" ? (
                            <>
                                <Notice tone="info">{s.deleteReplyBody}</Notice>
                                <Button busy={google.busy !== null} onPress={google.deleteReply}>
                                    {s.confirm}
                                </Button>
                                <Button
                                    variant="outline"
                                    disabled={google.busy !== null}
                                    onPress={() => {
                                        google.setConfirm(null);
                                    }}
                                >
                                    {s.cancel}
                                </Button>
                            </>
                        ) : null}
                    </div>
                </Modal>
            ) : null}
            {google.confirm === "disconnect" ? (
                <Modal
                    open
                    onClose={() => {
                        if (google.busy === null) google.setConfirm(null);
                    }}
                >
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-ink">{s.disconnect}</h2>
                        <p className="text-sm text-ink">{s.disconnectBody}</p>
                        <Button busy={google.busy !== null} onPress={google.disconnect}>
                            {s.confirm}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={google.busy !== null}
                            onPress={() => {
                                google.setConfirm(null);
                            }}
                        >
                            {s.cancel}
                        </Button>
                    </div>
                </Modal>
            ) : null}
            {asking && google.canRequest ? (
                <RequestReviewDialog
                    queue={queue}
                    onClose={() => {
                        setAsking(false);
                    }}
                />
            ) : null}
        </div>
    );
}

function AskPanel({ queue }: { queue: ReviewQueue }) {
    const zone = useBusinessZone();
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
                            <li key={x.bookingId} className="flex items-center gap-2.5 px-3 py-2.5">
                                <Avatar name={x.clientName} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-ink">
                                        {x.clientName}
                                    </div>
                                    <div className="truncate text-xs text-muted">{x.visit}</div>
                                </div>
                                {req.sent.has(x.bookingId) ? (
                                    <Badge label={s.asked} intent="success" />
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        busy={req.busyId === x.bookingId}
                                        disabled={!queue.canRequest}
                                        onPress={() => {
                                            req.request(x.clientId, x.bookingId);
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
                                        {s.requestedOn(dateOf(r.requested_at, zone))}
                                    </div>
                                </div>
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
                <SearchSelect
                    label={s.requestClient}
                    value={clientId}
                    placeholder={s.chooseClient}
                    options={queue.clientOptions}
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
                        disabled={clientId === "" || sent || !queue.canRequest}
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
