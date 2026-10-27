import {
    type Conversation,
    type InboxThread,
    BUSINESS_CURRENCY,
    formatPhone,
    consentDetail,
    consentLabel,
    strings,
    useBusinessZone,
    useConversation,
    usePeoplePhotos,
    useSubjectKind,
    openTask,
    openRecord,
} from "@clientbridge/app-core";
import { Avatar, Badge, Button, KeyValueList, Money } from "@clientbridge/ui";

import { api } from "../lib/api";

const s = strings.messaging;

/** The open conversation's client beside the thread; Open record shows their full record over the page. */
export function ThreadDetails({ thread }: { thread: InboxThread }) {
    const conversation = useConversation(api, thread);
    return (
        <aside
            aria-label={s.details}
            className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5"
        >
            <ContextPanel thread={thread} conversation={conversation} />
        </aside>
    );
}

export function ContextPanel({
    thread,
    conversation,
}: {
    thread: InboxThread;
    conversation: Conversation;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const client = conversation.client;
    const balance = client?.balance_cents ?? 0;
    const consent = consentLabel(conversation.consent);
    const consentInfo = consentDetail(conversation.consent, zone);
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <Avatar name={thread.title} src={photos.client(client?.id)} size="lg" />
                <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">
                        {thread.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                        {formatPhone(client?.phone ?? null)}
                    </p>
                </div>
            </div>
            <div className="flex gap-2">
                <Button
                    size="sm"
                    grow
                    onPress={() => {
                        openTask({ kind: "booking", clientId: thread.client_id });
                    }}
                >
                    {s.book}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    grow
                    onPress={() => {
                        openRecord("client", thread.client_id);
                    }}
                >
                    {s.openRecord}
                </Button>
            </div>
            <KeyValueList
                rows={[
                    ...(kind === null
                        ? []
                        : [
                              {
                                  label: strings.subjects.many(kind),
                                  value: client?.subject_names ?? "—",
                              },
                          ]),
                    {
                        label: s.balance,
                        value:
                            balance > 0 ? (
                                <Money currency={BUSINESS_CURRENCY} cents={balance} />
                            ) : (
                                s.settled
                            ),
                        intent: balance > 0 ? "warning" : undefined,
                    },
                    { label: s.nextVisit, value: conversation.nextVisit ?? s.nothingBooked },
                ]}
            />
            <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.consentTitle}
                </h3>
                <ul className="divide-y divide-line-soft rounded-md border border-line">
                    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-ink">
                                {s.consentChannel.sms}
                            </div>
                            {consentInfo !== null ? (
                                <div className="text-xs text-muted">{consentInfo}</div>
                            ) : null}
                        </div>
                        <span className="shrink-0">
                            <Badge label={consent.label} intent={consent.intent} />
                        </span>
                    </li>
                </ul>
            </section>
        </div>
    );
}
