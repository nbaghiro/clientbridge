import {
    type ReviewQueue,
    formatDate,
    parseTimestamp,
    strings,
    useRequestReview,
    useReviewQueue,
    useReviewSettings,
    useBusinessZone,
} from "@clientbridge/app-core";
import { Avatar, Badge, Button, Modal, Notice, Panel, Select, TextField } from "@clientbridge/ui";
import { useState } from "react";
import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
const s = strings.reviews;
const dateOf = (value: string, zone: string): string => formatDate(parseTimestamp(value), zone);

export function Reviews() {
    const queue = useReviewQueue();
    const settings = useReviewSettings(api, queue);
    const [asking, setAsking] = useState(false);
    return (
        <div className="space-y-5">
            <p className="text-sm text-muted">{s.subtitle}</p>
            <Loaded load={queue.load} loading={s.loading} failed={s.loadError}>
                <Panel>
                    <div className="space-y-4">
                        <TextField
                            label={s.googleUrl}
                            hint={s.googleUrlHint}
                            value={settings.googleUrl}
                            onChange={settings.setGoogleUrl}
                            onSubmit={settings.saveGoogleUrl}
                            placeholder={s.googleUrlPlaceholder}
                            type="url"
                        />
                        <Button size="sm" busy={settings.busy} onPress={settings.saveGoogleUrl}>
                            {s.saveLink}
                        </Button>
                        {settings.savedGoogle ? (
                            <Notice tone="success">{s.linkSaved}</Notice>
                        ) : null}
                        {settings.error !== null ? (
                            <Notice tone="danger">{settings.error}</Notice>
                        ) : null}
                    </div>
                </Panel>
                {queue.googleUrl === null ? <Notice tone="info">{s.linkRequired}</Notice> : null}
                <Button
                    icon="send"
                    disabled={queue.googleUrl === null}
                    onPress={() => {
                        setAsking(true);
                    }}
                >
                    {s.requestReview}
                </Button>
                <Panel>
                    <AskPanel queue={queue} />
                </Panel>
            </Loaded>
            {asking ? (
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
                                        disabled={queue.googleUrl === null}
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
                        disabled={clientId === "" || sent || queue.googleUrl === null}
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
