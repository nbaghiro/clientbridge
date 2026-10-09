import {
    type AgendaItem,
    type AttentionItem,
    type SetupProgress,
    type TodayActions,
    type OwnerToday,
    formatMoney,
    strings,
    useShellNav,
    visitAction,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Checklist,
    Empty,
    Icon,
    IconButton,
    ListRow,
    LoadFailed,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import type { RootStackParamList } from "../navigation";

const c = theme.colors;
const t = strings.today;

export function TodayHeader({
    dateLabel,
    greeting,
    bellCount,
    onSecretTap,
}: {
    dateLabel: string;
    greeting: string;
    bellCount: number;
    onSecretTap: () => void;
}) {
    const openLink = useOpenLink();
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    return (
        <View style={styles.header}>
            <View style={styles.headerText}>
                <Pressable onPress={onSecretTap} accessibilityRole="text">
                    <Text style={styles.date}>{dateLabel}</Text>
                </Pressable>
                <Text style={styles.greeting} accessibilityRole="header" numberOfLines={1}>
                    {greeting}
                </Text>
            </View>
            <IconButton
                icon="search"
                label={strings.navigation.search}
                onPress={() => {
                    openLink("search");
                }}
            />
            <IconButton
                icon="bell"
                label={strings.navigation.notifications}
                badge={bellCount}
                onPress={() => {
                    openLink("notifications");
                }}
            />
            <IconButton
                icon="settings"
                label={strings.navigation.setup}
                onPress={() => {
                    nav.navigate("Setup");
                }}
            />
        </View>
    );
}

export function PaymentsSummary({ owner }: { owner?: OwnerToday }) {
    const openLink = useOpenLink();
    const nav = useShellNav(useViewer());
    const overdue = nav.badges.payments ?? 0;
    const openPayments = (): void => {
        openLink("payments");
    };
    return (
        <Section
            title={strings.navigation.payments}
            action={
                <Button
                    size="sm"
                    variant="link"
                    label={strings.navigation.viewPayments}
                    onPress={openPayments}
                >
                    {t.viewAllPayments}
                </Button>
            }
        >
            {owner === undefined ? (
                <View style={styles.card}>
                    <ListRow
                        icon="pos"
                        title={strings.navigation.paymentsTabs.sales}
                        meta={<Icon name="chevronRight" size={18} color={c.muted} />}
                        onPress={openPayments}
                    />
                </View>
            ) : owner.moneyLoad.state === "loading" ? (
                <RowsLoading count={2} />
            ) : owner.moneyLoad.state === "error" ? (
                <NumbersFailed
                    onRetry={owner.moneyLoad.retry}
                    retrying={owner.moneyLoad.retrying}
                />
            ) : (
                <View style={styles.card}>
                    <View style={styles.paymentFigures}>
                        <View style={styles.flex}>
                            <Text style={styles.kpiLabel}>{t.collected}</Text>
                            <Text style={styles.kpiValue}>
                                {formatMoney(owner.money.collectedCents)}
                            </Text>
                            <Text style={styles.kpiHint}>
                                {t.collectedHint(owner.money.paymentCount)}
                            </Text>
                        </View>
                        <View style={styles.flex}>
                            <Text style={styles.kpiLabel}>{t.awaiting}</Text>
                            <Text style={styles.kpiValue}>
                                {formatMoney(owner.money.awaitingCents)}
                            </Text>
                            <Text style={styles.kpiHint}>
                                {t.awaitingHint(owner.money.awaitingCount)}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.paymentFooter}>
                        <Text style={styles.paymentCount}>
                            {overdue > 0
                                ? strings.navigation.overduePayments(overdue)
                                : t.noOverdueInvoices}
                        </Text>
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="link"
                            onPress={() => {
                                openLink("invoices");
                            }}
                        >
                            {strings.navigation.paymentsTabs.invoices}
                        </Button>
                    </View>
                </View>
            )}
        </Section>
    );
}

export interface MobileKpi {
    label: string;
    value: string;
    hint: string;
    tone?: "ink" | "success" | undefined;
}

export function KpiSummary({ items }: { items: MobileKpi[] }) {
    return (
        <View style={[styles.kpis, styles.paymentFiguresRow]}>
            {items.map((k) => (
                <View
                    key={k.label}
                    style={[styles.kpi, styles.flex]}
                    accessible
                    accessibilityLabel={`${k.label}, ${k.value}, ${k.hint}`}
                >
                    <Text style={styles.kpiLabel}>{k.label}</Text>
                    <Text style={[styles.kpiValue, k.tone === "success" && { color: c.success }]}>
                        {k.value}
                    </Text>
                    <Text style={styles.kpiHint} numberOfLines={1}>
                        {k.hint}
                    </Text>
                </View>
            ))}
        </View>
    );
}

export function KpiSummaryLoading() {
    return (
        <View style={styles.kpis}>
            <View style={[styles.card, styles.flex]}>
                <Skeleton variant="stat" count={2} columns={2} label={t.loading} />
            </View>
        </View>
    );
}

function NumbersFailed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
    return (
        <View>
            <LoadFailed
                variant="card"
                message={t.numbersError}
                body={t.numbersErrorBody}
                onRetry={onRetry}
                retrying={retrying}
            />
        </View>
    );
}

export function TodayFailed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
    return (
        <View style={styles.section}>
            <LoadFailed
                variant="card"
                message={t.loadError}
                body={t.loadErrorBody}
                onRetry={onRetry}
                retrying={retrying}
            />
        </View>
    );
}

export function QuietDay({ bookingLink }: { bookingLink: string | null }) {
    const openLink = useOpenLink();
    return (
        <View style={styles.card}>
            <Empty
                icon="calendar"
                message={t.quietTitle}
                body={t.quietBody}
                actions={
                    <>
                        <Button
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                openLink("booking");
                            }}
                        >
                            {t.newBooking}
                        </Button>
                        {bookingLink === null ? null : (
                            <Button
                                size="sm"
                                variant="outline"
                                onPress={() => {
                                    Share.share({ message: bookingLink }).catch(() => undefined);
                                }}
                            >
                                {t.shareLink}
                            </Button>
                        )}
                    </>
                }
            />
        </View>
    );
}

export function RowsLoading({ count = 4 }: { count?: number }) {
    return (
        <View style={styles.card}>
            <Skeleton variant="row" count={count} label={t.loading} />
        </View>
    );
}

export function Section({
    title,
    action,
    children,
}: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                    {title}
                </Text>
                {action}
            </View>
            {children}
        </View>
    );
}

export function NextCard({ item, children }: { item: AgendaItem; children?: ReactNode }) {
    return (
        <View style={styles.next}>
            <View style={styles.nextBody}>
                <View style={[styles.nextBar, { backgroundColor: item.color ?? c.accent }]} />
                <View style={styles.flex}>
                    <View style={styles.nextTop}>
                        <Text style={styles.nextTime}>
                            {item.time} – {item.endTime}
                        </Text>
                        <StatusPill
                            style={{ alignSelf: "center" }}
                            status={
                                item.checkedIn
                                    ? t.checkedIn
                                    : item.state === "now"
                                      ? t.stateNow
                                      : t.inMinutes(item.minutesAway)
                            }
                            intent={item.checkedIn || item.state === "now" ? "success" : "accent"}
                            asWritten
                        />
                    </View>
                    <Text style={styles.nextClient} numberOfLines={1}>
                        {item.clientName}
                    </Text>
                    <Text style={styles.nextService} numberOfLines={1}>
                        {item.serviceName} · {t.withStaff(item.staffName)}
                    </Text>
                </View>
            </View>
            {children}
        </View>
    );
}

export function NextActions({ item, actions }: { item: AgendaItem; actions: TodayActions }) {
    const openLink = useOpenLink();
    const action = visitAction(item);
    const id = item.bookingId;
    return (
        <View style={styles.nextActions}>
            {action === null || id === null ? null : (
                <Button
                    grow
                    busy={actions.busyKey === id}
                    onPress={() => {
                        if (action === "checkout") openLink("checkout", id);
                        else actions.checkIn(id);
                    }}
                >
                    {action === "checkout" ? t.checkout : t.checkIn}
                </Button>
            )}
            <Button
                grow
                variant="outline"
                onPress={() => {
                    openLink("message", item.clientId);
                }}
            >
                {t.staff.message}
            </Button>
        </View>
    );
}

export function AttentionList({
    items,
    actions,
    empty,
}: {
    items: AttentionItem[];
    actions: TodayActions;
    empty: string;
}) {
    const openLink = useOpenLink();
    return (
        <View style={styles.card}>
            {items.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
            {items.map((a, i) => {
                const sent = actions.sent.has(a.key);
                return (
                    <View key={a.key} style={i > 0 ? styles.divider : undefined}>
                        <ListRow
                            icon={a.icon}
                            intent={a.intent}
                            title={a.title}
                            detail={a.detail}
                            onPress={() => {
                                if (a.act === "open") openLink(a.target, a.refId);
                                else actions.send(a);
                            }}
                            meta={
                                a.act === "open" ? (
                                    <Icon name="chevron" size={16} color={c.muted} />
                                ) : (
                                    <Text style={[styles.metaAction, sent && { color: c.success }]}>
                                        {sent
                                            ? t.sent
                                            : actions.busyKey === a.key
                                              ? strings.common.busyEllipsis
                                              : a.action}
                                    </Text>
                                )
                            }
                        />
                    </View>
                );
            })}
        </View>
    );
}

export function AgendaRows({
    items,
    showStaff = true,
}: {
    items: AgendaItem[];
    showStaff?: boolean;
}) {
    return (
        <View style={styles.card}>
            {items.map((item, i) => {
                const done = item.state === "done";
                return (
                    <View key={item.id} style={[styles.agendaRow, i > 0 && styles.divider]}>
                        <View style={styles.agendaTime}>
                            <Text style={[styles.agendaClock, done && styles.muted]}>
                                {item.time}
                            </Text>
                        </View>
                        <View
                            style={[
                                styles.agendaBar,
                                {
                                    backgroundColor: item.color ?? c.accent,
                                    opacity: done ? 0.35 : 1,
                                },
                            ]}
                        />
                        <View style={styles.flex}>
                            <Text
                                style={[styles.agendaClient, done && styles.muted]}
                                numberOfLines={1}
                            >
                                {item.clientName}
                            </Text>
                            <Text style={styles.agendaSub} numberOfLines={1}>
                                {showStaff
                                    ? `${item.serviceName} · ${item.staffName}`
                                    : item.serviceName}
                            </Text>
                        </View>
                        {done ? (
                            <Icon name="check" size={17} color={c.success} label={t.stateDone} />
                        ) : null}
                        {item.depositDue ? (
                            <Badge
                                style={{ alignSelf: "center" }}
                                label={t.depositDue}
                                intent="warning"
                            />
                        ) : null}
                    </View>
                );
            })}
        </View>
    );
}

/** A new business's first days: what is left before clients can book, each with a way in. */
export function GettingStarted({ setup }: { setup: SetupProgress }) {
    const openLink = useOpenLink();
    return (
        <Section title={strings.business.getSetUp.gettingStarted}>
            <View style={[styles.card, styles.pad]}>
                <Text style={styles.stepsDone}>
                    {strings.business.getSetUp.progress(setup.done, setup.total)}
                </Text>
                <Checklist
                    label={strings.business.getSetUp.gettingStarted}
                    items={setup.steps.map((x) => ({
                        key: x.key,
                        label: x.label,
                        hint: x.hint,
                        done: x.done,
                        action: x.done
                            ? undefined
                            : {
                                  label: strings.business.getSetUp.start,
                                  onPress: () => {
                                      openLink(x.target);
                                  },
                              },
                    }))}
                />
            </View>
        </Section>
    );
}

const styles = StyleSheet.create({
    paymentFigures: { flexDirection: "row", gap: 16, padding: 16 },
    paymentFooter: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTopWidth: 1,
        borderTopColor: c.border,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    paymentCount: { color: c.muted, fontSize: 12 },
    flex: { flex: 1, minWidth: 0 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 10,
    },
    headerText: { flex: 1, minWidth: 0 },
    date: { color: c.muted, fontSize: 13, fontWeight: "600" },
    greeting: { color: c.ink, fontSize: 24, fontWeight: "700", letterSpacing: -0.4, marginTop: 1 },
    kpis: { paddingHorizontal: 20, gap: 10, paddingBottom: 4 },
    paymentFiguresRow: { flexDirection: "row" },
    kpi: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 12,
    },
    kpiLabel: { color: c.muted, fontSize: 12, fontWeight: "600" },
    kpiValue: {
        color: c.ink,
        fontSize: 21,
        fontWeight: "700",
        marginTop: 4,
        fontVariant: ["tabular-nums"],
    },
    kpiHint: { color: c.muted, fontSize: 11.5, marginTop: 2 },
    section: { paddingHorizontal: 20, marginTop: 22 },
    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
    },
    sectionTitle: { color: c.ink, fontSize: 17, fontWeight: "700" },
    next: {
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
    },
    nextTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    nextBody: { flexDirection: "row", gap: 12 },
    nextBar: { width: 4, borderRadius: 2 },
    nextTime: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    nextClient: { color: c.ink, fontSize: 19, fontWeight: "700", marginTop: 2 },
    nextService: { color: c.muted, fontSize: 14, marginTop: 2 },
    nextActions: { flexDirection: "row", gap: 10, marginTop: 12 },
    card: {
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    metaAction: { color: c.accent, fontSize: 13, fontWeight: "600" },
    empty: { color: c.muted, fontSize: 14, textAlign: "center", paddingVertical: 24 },
    agendaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 11,
        paddingHorizontal: 14,
    },
    agendaTime: { width: 74 },
    agendaClock: { color: c.ink, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
    agendaBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
    agendaClient: { color: c.ink, fontSize: 15, fontWeight: "600" },
    agendaSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    muted: { color: c.muted },
    pad: { padding: 14 },
    stepsDone: { color: c.muted, fontSize: 13, marginBottom: 6 },
});
