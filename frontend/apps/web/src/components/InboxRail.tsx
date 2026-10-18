import {
    type Channel,
    type Conversation,
    type InboxSegmentKey,
    type InboxThread,
    BUSINESS_CURRENCY,
    broadcastIntent,
    broadcastWhen,
    consentDetail,
    consentLabel,
    formatAverageRating,
    roundedRating,
    strings,
    useBroadcastsHome,
    useBusinessZone,
    useContractLibrary,
    useConversation,
    useFormLibrary,
    useReviewQueue,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    IconButton,
    KeyValueList,
    Money,
    Stars,
    StatusPill,
} from "@clientbridge/ui";
import type { ReactNode } from "react";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];
const SHOWN = 3;

interface Area {
    key: InboxSegmentKey;
    label: string;
}

function RailSection({
    title,
    count,
    active,
    onOpen,
    children,
}: {
    title: string;
    count?: number;
    active: boolean;
    onOpen: () => void;
    children: ReactNode;
}) {
    return (
        <section
            aria-label={title}
            className={`rounded-lg px-3 py-3 ${active ? "bg-accent-weak/60" : ""}`}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {title}
                    {count !== undefined && count > 0 ? (
                        <span className="rounded-full bg-bg px-1.5 text-[11px] text-ink-soft">
                            {count}
                        </span>
                    ) : null}
                </h3>
                {active ? null : (
                    <IconButton
                        size="sm"
                        icon="chevronRight"
                        label={s.rail.open(title)}
                        onPress={onOpen}
                    />
                )}
            </div>
            {children}
        </section>
    );
}

function ReviewsTeaser({ area, active, onOpen }: TeaserProps) {
    const queue = useReviewQueue();
    const latest = queue.all[0];
    return (
        <RailSection title={area.label} count={queue.held.length} active={active} onOpen={onOpen}>
            {queue.count === 0 ? (
                <p className="text-sm text-muted">{strings.reviews.noReviewsTitle}</p>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="font-display text-2xl font-bold text-ink">
                            {formatAverageRating(queue.average)}
                        </span>
                        <div>
                            <Stars value={roundedRating(queue.average)} size="sm" />
                            <p className="text-xs text-muted">{s.rail.reviewCount(queue.count)}</p>
                        </div>
                    </div>
                    {queue.held.length > 0 ? (
                        <p className="text-sm font-medium text-warn-fg">
                            {s.rail.reviewsHeld(queue.held.length)}
                        </p>
                    ) : null}
                    {latest !== undefined ? (
                        <div className="rounded-md border border-line bg-surface p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-ink">
                                    {latest.client_name}
                                </span>
                                <Stars value={latest.rating} size="sm" />
                            </div>
                            {latest.body !== null && latest.body !== "" ? (
                                <p className="mt-1 line-clamp-3 text-sm text-ink-soft">
                                    {latest.body}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            )}
        </RailSection>
    );
}

function BroadcastsTeaser({ area, active, onOpen }: TeaserProps) {
    const zone = useBusinessZone();
    const home = useBroadcastsHome();
    const last = home.broadcasts[0];
    const b = strings.broadcasts;
    return (
        <RailSection title={area.label} active={active} onOpen={onOpen}>
            <div className="space-y-2">
                {last === undefined ? (
                    <p className="text-sm text-muted">{b.noBroadcasts}</p>
                ) : (
                    <div className="rounded-md border border-line bg-surface p-3">
                        <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-semibold text-ink">
                                {last.name}
                            </span>
                            <StatusPill
                                status={b.status[last.status] ?? last.status}
                                intent={broadcastIntent(last.status)}
                            />
                        </div>
                        <p className="mt-0.5 text-xs text-muted">{broadcastWhen(last, zone)}</p>
                    </div>
                )}
                {home.reach.total === 0 ? null : (
                    <p className="text-xs text-muted">
                        {s.rail.reach(home.reach.sms, home.reach.email)}
                    </p>
                )}
            </div>
        </RailSection>
    );
}

function WaitingList({ rows }: { rows: { id: string; name: string; waiting: string }[] }) {
    return rows.length === 0 ? null : (
        <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line bg-surface">
            {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.name}</span>
                    <span className="shrink-0">
                        <Badge label={r.waiting} intent="warning" />
                    </span>
                </li>
            ))}
        </ul>
    );
}

function FormsTeaser({ area, active, onOpen }: TeaserProps) {
    const library = useFormLibrary();
    const waiting = library.forms.filter((f) => f.waiting > 0);
    const total = waiting.reduce((n, f) => n + f.waiting, 0);
    return (
        <RailSection title={area.label} count={total} active={active} onOpen={onOpen}>
            <p className="text-sm text-muted">{s.rail.formsWaiting(total)}</p>
            <WaitingList
                rows={waiting.slice(0, SHOWN).map((f) => ({
                    id: f.id,
                    name: f.name,
                    waiting: strings.forms.waiting(f.waiting),
                }))}
            />
        </RailSection>
    );
}

function ContractsTeaser({ area, active, onOpen }: TeaserProps) {
    const library = useContractLibrary();
    const waiting = library.contracts.filter((c) => c.waiting > 0);
    const total = waiting.reduce((n, c) => n + c.waiting, 0);
    return (
        <RailSection title={area.label} count={total} active={active} onOpen={onOpen}>
            <p className="text-sm text-muted">{s.rail.signaturesWaiting(total)}</p>
            <WaitingList
                rows={waiting.slice(0, SHOWN).map((c) => ({
                    id: c.contract.id,
                    name: c.contract.name,
                    waiting: strings.contracts.waitingCount(c.waiting),
                }))}
            />
        </RailSection>
    );
}

interface TeaserProps {
    area: Area;
    active: boolean;
    onOpen: () => void;
}

const TEASERS: Partial<Record<InboxSegmentKey, (p: TeaserProps) => ReactNode>> = {
    reviews: ReviewsTeaser,
    broadcasts: BroadcastsTeaser,
    forms: FormsTeaser,
    contracts: ContractsTeaser,
};

/** The Inbox's right rail: the open conversation's client, then a look at each other area. */
export function InboxRail({
    areas,
    active,
    thread,
    onOpen,
}: {
    areas: readonly Area[];
    active: InboxSegmentKey;
    thread: InboxThread | null;
    onOpen: (key: InboxSegmentKey) => void;
}) {
    return (
        <div className="space-y-2 px-2 py-3">
            {thread !== null ? <ClientRail key={thread.id} thread={thread} /> : null}
            {areas.map((area) => {
                const Teaser = TEASERS[area.key];
                return Teaser === undefined ? null : (
                    <Teaser
                        key={area.key}
                        area={area}
                        active={area.key === active}
                        onOpen={() => {
                            onOpen(area.key);
                        }}
                    />
                );
            })}
        </div>
    );
}

function ClientRail({ thread }: { thread: InboxThread }) {
    const conversation = useConversation(api, thread);
    return (
        <aside aria-label={s.details} className="border-b border-line-soft px-3 pb-5 pt-2">
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
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const openLink = useOpenLink();
    const client = conversation.client;
    const balance = client?.balance_cents ?? 0;
    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <Avatar name={thread.title} size="lg" />
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
                        openLink("booking");
                    }}
                >
                    {s.book}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    grow
                    onPress={() => {
                        openLink("client", thread.client_id);
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
