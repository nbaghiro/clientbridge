import {
    type Channel,
    type Conversation,
    type InboxThread,
    BUSINESS_CURRENCY,
    canManagePayments,
    useClientDirectory,
    consentDetail,
    consentLabel,
    strings,
    useBusinessZone,
    useConversation,
    usePeoplePhotos,
    useSubjectKind,
    openTask,
} from "@clientbridge/app-core";
import { Avatar, Badge, Button, KeyValueList, Money } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import { type ClientDialog, ClientDialogs, ClientRecordView } from "./ClientRecord";

const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];

/** The open conversation's client beside the thread; Open record shows the Clients page record. */
export function ThreadDetails({ thread }: { thread: InboxThread }) {
    const [record, setRecord] = useState(false);
    return record ? (
        <RailRecord
            clientId={thread.client_id}
            onClose={() => {
                setRecord(false);
            }}
        />
    ) : (
        <ClientRail
            thread={thread}
            onOpenRecord={() => {
                setRecord(true);
            }}
        />
    );
}

function ClientRail({ thread, onOpenRecord }: { thread: InboxThread; onOpenRecord: () => void }) {
    const conversation = useConversation(api, thread);
    return (
        <aside
            aria-label={s.details}
            className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5"
        >
            <ContextPanel thread={thread} conversation={conversation} onOpenRecord={onOpenRecord} />
        </aside>
    );
}

// The same record the Clients page shows, at its width, so the conversation stays on screen.
function RailRecord({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const manager = canManagePayments(useRole());
    const directory = useClientDirectory();
    const [dialog, setDialog] = useState<ClientDialog | null>(null);
    return (
        <aside
            aria-label={strings.clients.record.pane}
            className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface xl:w-[420px]"
        >
            <ClientRecordView
                visible
                variant="inline"
                clientId={clientId}
                manager={manager}
                onClose={onClose}
                onDialog={setDialog}
            />
            <ClientDialogs
                dialog={dialog}
                directory={directory.all}
                onOpenClient={() => {
                    setDialog(null);
                }}
                onMerged={() => {
                    setDialog(null);
                }}
                onClose={() => {
                    setDialog(null);
                }}
            />
        </aside>
    );
}

export function ContextPanel({
    thread,
    conversation,
    onOpenRecord,
}: {
    thread: InboxThread;
    conversation: Conversation;
    onOpenRecord?: () => void;
}) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const openLink = useOpenLink();
    const client = conversation.client;
    const balance = client?.balance_cents ?? 0;
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <Avatar name={thread.title} src={photos.client(client?.id)} size="lg" />
                <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">
                        {thread.title}
                    </p>
                    <p className="truncate text-xs text-muted">{client?.email}</p>
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
                        if (onOpenRecord === undefined) openLink("client", thread.client_id);
                        else onOpenRecord();
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
                    {CHANNELS.map((ch) => {
                        const v = conversation.consent[ch];
                        const state = consentLabel(v);
                        const detail = consentDetail(v, zone);
                        return (
                            <li
                                key={ch}
                                className="flex items-start justify-between gap-3 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-ink">
                                        {s.consentChannel[ch]}
                                    </div>
                                    {detail !== null ? (
                                        <div className="text-xs text-muted">{detail}</div>
                                    ) : null}
                                </div>
                                <span className="shrink-0">
                                    <Badge label={state.label} intent={state.intent} />
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}
