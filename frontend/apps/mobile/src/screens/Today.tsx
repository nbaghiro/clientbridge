import {
    bookingPageUrl,
    canManagePayments,
    formatMoney,
    strings,
    useNotifications,
    useOwnerToday,
    useSetupProgress,
    useStaffToday,
    useSyncState,
    useTodayActions,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Empty, Notice, SyncBanner } from "@clientbridge/ui";

import { DebugOverlay } from "../components/DebugOverlay";
import {
    AgendaRows,
    AttentionList,
    GettingStarted,
    KpiScroller,
    KpiScrollerLoading,
    NextActions,
    NextCard,
    NumbersFailed,
    QuietDay,
    RowsLoading,
    Section,
    TodayFailed,
    TodayHeader,
} from "../components/TodayParts";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { bookUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const t = strings.today;

export function TodayScreen() {
    const viewer = useViewer();
    const notifications = useNotifications(viewer);
    const sync = useSyncState();
    const [debugOpen, setDebugOpen] = useState(false);
    const taps = useRef<number[]>([]);
    const onSecretTap = (): void => {
        const now = Date.now();
        taps.current = [...taps.current, now].filter((x) => now - x < 1500);
        if (taps.current.length >= 5) {
            taps.current = [];
            setDebugOpen(true);
        }
    };

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <StatusBar style="dark" />
            {!sync.online && sync.hasSynced ? (
                <SyncBanner
                    state="offline"
                    title={strings.sync.offlineTitle}
                    detail={strings.sync.offlineStrip(sync.pendingCount)}
                />
            ) : null}
            {viewer === null ? null : canManagePayments(viewer.role) ? (
                <OwnerToday bell={notifications.unread} onSecretTap={onSecretTap} />
            ) : (
                <StaffToday bell={notifications.unread} onSecretTap={onSecretTap} />
            )}
            <DebugOverlay
                visible={debugOpen}
                onClose={() => {
                    setDebugOpen(false);
                }}
            />
        </SafeAreaView>
    );
}

function Body({ children }: { children: ReactNode }) {
    return <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>;
}

function OwnerToday({ bell, onSecretTap }: { bell: number; onSecretTap: () => void }) {
    const viewer = useViewer();
    const { load, view, money, moneyLoad } = useOwnerToday(api, viewer);
    const actions = useTodayActions(api);
    const openLink = useOpenLink();
    const setup = useSetupProgress();
    const bookingLink = setup.slug === null ? null : bookingPageUrl(bookUrl, setup.slug);
    const loading = load.state === "loading";
    const firstRun = load.hasData && view.agenda.length === 0 && !setup.complete;
    const focus = view.current ?? view.next;
    const later = view.agenda.filter((a) => a !== focus && a.state !== "done");

    return (
        <>
            <TodayHeader
                dateLabel={view.dateLabel}
                greeting={view.greeting}
                bellCount={bell}
                onSecretTap={onSecretTap}
            />
            {load.state === "error" ? (
                <TodayFailed onRetry={load.retry} retrying={load.retrying} />
            ) : (
                <Body>
                    {actions.error !== null ? (
                        <View style={styles.notice}>
                            <Notice tone="danger" banner>
                                {actions.error}
                            </Notice>
                        </View>
                    ) : null}
                    {loading || moneyLoad.state === "loading" ? (
                        <KpiScrollerLoading />
                    ) : moneyLoad.state === "error" ? (
                        <NumbersFailed onRetry={moneyLoad.retry} retrying={moneyLoad.retrying} />
                    ) : (
                        <KpiScroller
                            items={[
                                {
                                    label: t.booked,
                                    value: String(view.agenda.length),
                                    hint: t.bookedHint(view.done, view.remaining),
                                },
                                {
                                    label: t.expected,
                                    value: formatMoney(view.expectedCents),
                                    hint: t.expectedHint,
                                },
                                {
                                    label: t.collected,
                                    value: formatMoney(money.collectedCents),
                                    hint: t.collectedHint(money.paymentCount),
                                    tone: "success",
                                },
                                {
                                    label: t.awaiting,
                                    value: formatMoney(money.awaitingCents),
                                    hint: t.awaitingHint(money.awaitingCount),
                                },
                            ]}
                        />
                    )}
                    {focus === null ? null : (
                        <Section title={focus.state === "now" ? t.stateNow : t.upNext}>
                            <NextCard item={focus}>
                                <NextActions item={focus} actions={actions} />
                            </NextCard>
                        </Section>
                    )}
                    {firstRun ? <GettingStarted setup={setup} /> : null}
                    <Section title={t.needsYou}>
                        {loading ? (
                            <RowsLoading count={3} />
                        ) : (
                            <AttentionList
                                items={view.attention}
                                actions={actions}
                                empty={t.allClear}
                            />
                        )}
                    </Section>
                    <Section
                        title={t.restOfDay}
                        action={
                            <Button
                                size="sm"
                                variant="link"
                                onPress={() => {
                                    openLink("schedule");
                                }}
                            >
                                {t.openSchedule}
                            </Button>
                        }
                    >
                        {loading ? (
                            <RowsLoading />
                        ) : later.length === 0 ? (
                            <QuietDay bookingLink={bookingLink} />
                        ) : (
                            <AgendaRows items={later} />
                        )}
                    </Section>
                </Body>
            )}
        </>
    );
}

function StaffToday({ bell, onSecretTap }: { bell: number; onSecretTap: () => void }) {
    const viewer = useViewer();
    const { load, view, day } = useStaffToday(viewer);
    const actions = useTodayActions(api);
    const next = view.current ?? view.next;
    const later = view.agenda.filter((a) => a !== next && a.state !== "done");

    return (
        <>
            <TodayHeader
                dateLabel={view.dateLabel}
                greeting={view.greeting}
                bellCount={bell}
                onSecretTap={onSecretTap}
            />
            {load.state === "error" ? (
                <TodayFailed onRetry={load.retry} retrying={load.retrying} />
            ) : load.state === "loading" ? (
                <View style={styles.loading}>
                    <RowsLoading count={4} />
                </View>
            ) : (
                <Body>
                    <Text style={styles.sub}>{t.staff.subtitle(view.agenda.length)}</Text>
                    {actions.error !== null ? (
                        <View style={styles.notice}>
                            <Notice tone="danger" banner>
                                {actions.error}
                            </Notice>
                        </View>
                    ) : null}
                    <Section title={t.staff.nextClient}>
                        {next === null ? (
                            <View style={styles.card}>
                                <Empty
                                    icon="calendar"
                                    message={
                                        view.agenda.length === 0
                                            ? t.staff.subtitle(0)
                                            : t.staff.noNext
                                    }
                                    body={t.staff.noNextBody}
                                />
                            </View>
                        ) : (
                            <NextCard item={next}>
                                <NextActions item={next} actions={actions} />
                            </NextCard>
                        )}
                    </Section>
                    <View style={styles.facts}>
                        <View style={styles.fact}>
                            <Text style={styles.factLabel}>{t.staff.earnings}</Text>
                            <Text style={[styles.factValue, { color: c.success }]}>
                                {formatMoney(day.earnedCents)}
                            </Text>
                            <Text style={styles.factHint}>{t.staff.earningsHint}</Text>
                        </View>
                        <View style={styles.fact}>
                            <Text style={styles.factLabel}>{t.staff.hours}</Text>
                            <Text style={styles.factValue}>{day.hours ?? t.teamOff}</Text>
                            <Text style={styles.factHint}>
                                {t.staff.tomorrow}: {t.teamCount(day.tomorrow)}
                            </Text>
                        </View>
                    </View>
                    {later.length === 0 ? null : (
                        <Section title={t.restOfDay}>
                            <AgendaRows items={later} showStaff={false} />
                        </Section>
                    )}
                    <Section title={t.staff.messagesForYou}>
                        <AttentionList
                            items={view.attention}
                            actions={actions}
                            empty={t.staff.nothingElse}
                        />
                    </Section>
                </Body>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { paddingTop: 4, paddingBottom: 32 },
    notice: { paddingHorizontal: 20, paddingBottom: 10 },
    loading: { paddingHorizontal: 20, paddingTop: 12 },
    sub: { color: c.muted, fontSize: 14, paddingHorizontal: 20 },
    card: {
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    facts: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginTop: 22 },
    fact: {
        flex: 1,
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
    },
    factLabel: { color: c.muted, fontSize: 12, fontWeight: "600" },
    factValue: { color: c.ink, fontSize: 18, fontWeight: "700", marginTop: 4 },
    factHint: { color: c.muted, fontSize: 12, marginTop: 3, lineHeight: 16 },
});
