import {
    type AgendaItem,
    type AttentionItem,
    type SetupProgress,
    type TodayActions,
    strings,
    useShellNav,
    visitAction,
    visitActionLabel,
    arrivalWords,
    useSubjectKind,
    formatList,
    formatParts,
    type TeamDay,
    mediaUrl,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Empty,
    Icon,
    IconButton,
    PageHeader,
    Panel,
    ListRow,
    LoadFailed,
    Meter,
    Skeleton,
    StatusPill,
    Avatar,
    IconBadge,
    ItemImage,
    useTabletLayout,
} from "@clientbridge/ui";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ReactNode } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import { apiBaseUrl } from "../lib/api";
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
        <PageHeader
            style={styles.header}
            title={greeting}
            leading={
                <Pressable onPress={onSecretTap} accessibilityRole="text">
                    <Text style={styles.date}>{dateLabel}</Text>
                </Pressable>
            }
            actions={
                <>
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
                </>
            }
        />
    );
}

/** Sales for staff; for an owner, whose figures sit in the strip above, what is overdue. */
export function PaymentsSummary({ owner = false }: { owner?: boolean }) {
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
            {!owner ? (
                <Panel flush>
                    <ListRow
                        icon="pos"
                        title={strings.navigation.paymentsTabs.sales}
                        meta={<Icon name="chevronRight" size={18} color={c.muted} />}
                        onPress={openPayments}
                    />
                </Panel>
            ) : (
                <Panel flush>
                    <View style={styles.paymentRow}>
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
                </Panel>
            )}
        </Section>
    );
}

export interface MobileKpi {
    label: string;
    value: string;
    hint: string;
    tone?: "ink" | "success" | undefined;
    // How far through the day this figure is, drawn as a thin bar under it.
    progress?: { value: number; max: number } | undefined;
}

/** The day's figures in one card: four across on a tablet, two by two on a phone. */
export function KpiSummary({ items }: { items: MobileKpi[] }) {
    const wide = useTabletLayout();
    return (
        <View style={styles.kpis}>
            <View style={styles.strip}>
                {items.map((k) => (
                    <View
                        key={k.label}
                        style={[styles.kpi, wide ? styles.kpiWide : styles.kpiHalf]}
                        accessible
                        accessibilityLabel={formatList([k.label, k.value, k.hint], "unit")}
                    >
                        <Text style={styles.kpiLabel}>{k.label}</Text>
                        <Text
                            style={[styles.kpiValue, k.tone === "success" && { color: c.success }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                        >
                            {k.value}
                        </Text>
                        {k.progress !== undefined ? (
                            <Meter
                                style={styles.kpiMeter}
                                value={k.progress.value}
                                max={Math.max(1, k.progress.max)}
                                label={k.hint}
                                labelPosition="hidden"
                                size="sm"
                            />
                        ) : null}
                        <Text style={styles.kpiHint}>{k.hint}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

/** The strip's four cards while the figures load, so nothing moves when they arrive. */
export function KpiSummaryLoading() {
    const wide = useTabletLayout();
    return (
        <View style={styles.kpis}>
            <View style={styles.strip}>
                {[0, 1, 2, 3].map((i) => (
                    <View
                        key={i}
                        style={[styles.kpi, styles.kpiBare, wide ? styles.kpiWide : styles.kpiHalf]}
                    >
                        <Skeleton variant="stat" count={1} label={t.loading} />
                    </View>
                ))}
            </View>
        </View>
    );
}

export function NumbersFailed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
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
        <Panel flush>
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
        </Panel>
    );
}

export function RowsLoading({ count = 4 }: { count?: number }) {
    return (
        <Panel flush>
            <Skeleton variant="row" count={count} label={t.loading} />
        </Panel>
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
    const kind = useSubjectKind();
    const photos = usePeoplePhotos();
    return (
        <Panel>
            <View style={styles.nextBody}>
                <View style={[styles.nextBar, { backgroundColor: item.color ?? c.accent }]} />
                <Avatar
                    name={item.clientName}
                    src={item.clientId === null ? null : photos.client(item.clientId)}
                    size="lg"
                />
                <View style={styles.flex}>
                    <View style={styles.nextTop}>
                        <Text style={styles.nextTime}>
                            {item.time} – {item.endTime}
                        </Text>
                        <StatusPill
                            style={{ alignSelf: "center" }}
                            status={
                                item.checkedIn
                                    ? arrivalWords(kind).done
                                    : item.departed
                                      ? t.onTheWay
                                      : item.state === "now"
                                        ? t.stateNow
                                        : item.startsIn
                            }
                            intent={item.checkedIn || item.state === "now" ? "success" : "accent"}
                        />
                    </View>
                    <Text style={styles.nextClient} numberOfLines={1}>
                        {item.clientName}
                    </Text>
                    <View style={styles.nextWith}>
                        <ItemImage
                            src={mediaUrl(apiBaseUrl, item.serviceImageId)}
                            name={item.serviceName}
                            color={item.color}
                            size={20}
                        />
                        <Text style={[styles.nextService, styles.flex]} numberOfLines={1}>
                            {formatParts([item.serviceName, t.withStaff(item.staffName)])}
                        </Text>
                        <Avatar
                            name={item.staffName}
                            src={photos.staff(item.staffId)}
                            size="sm"
                            color={item.staffColor}
                        />
                    </View>
                    {item.pickup !== null ? (
                        <Text style={styles.nextService} numberOfLines={2}>
                            {item.pickup}
                        </Text>
                    ) : null}
                </View>
            </View>
            {children}
        </Panel>
    );
}

export function NextActions({ item, actions }: { item: AgendaItem; actions: TodayActions }) {
    const openLink = useOpenLink();
    const kind = useSubjectKind();
    const action = visitAction(item, kind);
    const id = item.bookingId;
    const owed = id === null || item.checkedIn ? 0 : (actions.owed[id] ?? 0);
    return (
        <View style={styles.nextActions}>
            {owed > 0 ? (
                <StatusPill
                    style={{ alignSelf: "center" }}
                    status={t.toDo(owed)}
                    intent="warning"
                />
            ) : null}
            {action === null || id === null ? null : (
                <Button
                    grow
                    busy={actions.busyKey === id}
                    onPress={() => {
                        if (action === "checkout") openLink("checkout", id);
                        else if (action === "depart") actions.depart(id);
                        else actions.openCheckIn(id);
                    }}
                >
                    {visitActionLabel(action, kind)}
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
        <Panel flush>
            {items.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
            {items.map((a, i) => {
                const sent = actions.sent.has(a.key);
                return (
                    <View key={a.key} style={i > 0 ? styles.divider : undefined}>
                        <ListRow
                            leading={<IconBadge icon={a.icon} intent={a.intent} size="sm" />}
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
        </Panel>
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
        <Panel flush>
            {items.map((item, i) => {
                const done = item.state === "done";
                return (
                    <View key={item.id} style={[styles.agendaRow, i > 0 && styles.divider]}>
                        <View style={styles.agendaTime}>
                            <Text
                                style={[styles.agendaClock, done && styles.muted]}
                                numberOfLines={1}
                            >
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
                        <ItemImage
                            src={mediaUrl(apiBaseUrl, item.serviceImageId)}
                            name={item.serviceName}
                            color={item.color}
                            size={32}
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
                                    ? formatParts([item.serviceName, item.staffName])
                                    : item.serviceName}
                            </Text>
                            {item.pickup !== null ? (
                                <Text style={styles.agendaSub} numberOfLines={1}>
                                    {item.pickup}
                                </Text>
                            ) : null}
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
        </Panel>
    );
}

/** Who is working today and how many visits each has, as on the web's Today. */
export function TeamToday({ team }: { team: TeamDay[] }) {
    const photos = usePeoplePhotos();
    return (
        <Section title={t.team}>
            <Panel flush>
                {team.map((m, i) => (
                    <View key={m.staffId} style={[styles.teamRow, i > 0 && styles.divider]}>
                        <Avatar
                            name={m.name}
                            src={photos.staff(m.staffId)}
                            size="sm"
                            color={m.color}
                        />
                        <View style={styles.flex}>
                            <Text style={styles.agendaClient} numberOfLines={1}>
                                {m.name}
                            </Text>
                            <Text style={styles.agendaSub} numberOfLines={1}>
                                {m.hours ?? t.teamOff}
                            </Text>
                        </View>
                        <Text style={styles.paymentCount}>{t.teamCount(m.bookings)}</Text>
                    </View>
                ))}
            </Panel>
        </Section>
    );
}

/** A new business's first days: what is left before clients can book, each with a way in. */
/** A new account's lead section: the next step first, the rest compact, finished steps on one line. */
export function SetupGuide({ setup }: { setup: SetupProgress }) {
    const openLink = useOpenLink();
    const pending = setup.steps.filter((x) => !x.done);
    const done = setup.steps.filter((x) => x.done);
    const [next, ...later] = pending;
    const progress = strings.business.getSetUp.progress(setup.done, setup.total);
    return (
        <Section title={strings.business.getSetUp.gettingStarted}>
            <Panel flush>
                <View style={styles.guideHead}>
                    <Text style={styles.stepsDone}>{progress}</Text>
                    <Meter
                        value={setup.done}
                        max={setup.total}
                        label={progress}
                        labelPosition="hidden"
                    />
                </View>
                {next !== undefined ? (
                    <View style={styles.guideNext}>
                        <Text style={styles.guideEyebrow}>{t.guideNext}</Text>
                        <Text style={styles.guideTitle}>{next.label}</Text>
                        <Text style={styles.guideHint}>{next.hint}</Text>
                        <Button
                            style={styles.guideStart}
                            size="sm"
                            onPress={() => {
                                openLink(next.target);
                            }}
                        >
                            {strings.business.getSetUp.start}
                        </Button>
                    </View>
                ) : null}
                {later.map((x) => (
                    <View key={x.key} style={[styles.guideRow, styles.divider]}>
                        <View style={styles.flex}>
                            <Text style={styles.guideRowTitle}>{x.label}</Text>
                            <Text style={styles.guideHint}>{x.hint}</Text>
                        </View>
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                openLink(x.target);
                            }}
                        >
                            {strings.business.getSetUp.start}
                        </Button>
                    </View>
                ))}
                {done.length > 0 ? (
                    <View style={[styles.guideRow, styles.divider]}>
                        <Icon name="check" size={16} color={c.success} />
                        <Text style={[styles.guideHint, styles.flex]}>
                            {t.guideDone(formatList(done.map((x) => x.label)))}
                        </Text>
                    </View>
                ) : null}
            </Panel>
        </Section>
    );
}

/** The day while nothing has been booked yet: one line and the booking link. */
export function QuietSchedule({ bookingLink }: { bookingLink: string | null }) {
    return (
        <Panel>
            <Text style={styles.guideHint}>{t.guideNothingToday}</Text>
            {bookingLink === null ? null : (
                <Button
                    style={styles.guideStart}
                    size="sm"
                    variant="outline"
                    onPress={() => {
                        Share.share({ message: bookingLink }).catch(() => undefined);
                    }}
                >
                    {t.shareLink}
                </Button>
            )}
        </Panel>
    );
}

const styles = StyleSheet.create({
    paymentRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    paymentCount: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12 },
    flex: { flex: 1, minWidth: 0 },
    header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
    date: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 1,
    },
    kpis: { paddingHorizontal: 20, paddingBottom: 4 },
    // Separate cards with the page showing between them, like the rest of Today.
    strip: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    kpi: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
    },
    kpiWide: { flex: 1, minWidth: 0 },
    // The stat skeleton brings its own padding, the same as a figure card's.
    kpiBare: { paddingHorizontal: 0, paddingVertical: 0 },
    kpiHalf: { flexBasis: "40%", flexGrow: 1, minWidth: 0 },
    kpiMeter: { marginTop: 8 },
    kpiLabel: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "600" },
    kpiValue: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 21,
        fontWeight: "700",
        marginTop: 4,
        fontVariant: ["tabular-nums"],
    },
    kpiHint: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 11.5, marginTop: 2 },
    section: { paddingHorizontal: 20, marginTop: 22 },
    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
    },
    sectionTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    nextTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    nextBody: { flexDirection: "row", alignItems: "center", gap: 12 },
    nextBar: { width: 4, borderRadius: 2, alignSelf: "stretch" },
    nextTime: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 13, fontWeight: "600" },
    nextClient: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 19,
        fontWeight: "700",
        marginTop: 2,
    },
    nextService: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14, marginTop: 2 },
    nextActions: { flexDirection: "row", gap: 10, marginTop: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    metaAction: { color: c.accent, fontFamily: theme.fonts.ui, fontSize: 13, fontWeight: "600" },
    empty: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        textAlign: "center",
        paddingVertical: 24,
    },
    agendaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 11,
        paddingHorizontal: 14,
    },
    agendaTime: { width: 86 },
    agendaClock: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontWeight: "600",
        fontVariant: ["tabular-nums"],
    },
    agendaBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
    teamRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
    },
    nextWith: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    agendaClient: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15, fontWeight: "600" },
    agendaSub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 1 },
    muted: { color: c.muted },
    stepsDone: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginBottom: 8 },
    guideHead: { padding: 14 },
    guideNext: {
        marginHorizontal: 14,
        marginBottom: 14,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.accentLine,
        backgroundColor: c.accentWeak,
    },
    guideEyebrow: { color: c.accent, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "700" },
    guideTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 16,
        fontWeight: "700",
        marginTop: 4,
    },
    guideHint: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        marginTop: 2,
        lineHeight: 18,
    },
    guideStart: { alignSelf: "flex-start", marginTop: 12 },
    guideRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    guideRowTitle: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15, fontWeight: "600" },
});
