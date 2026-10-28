import {
    bookingPageUrl,
    canManagePayments,
    firstRunLayout,
    formatMoney,
    strings,
    useNotifications,
    useOwnerToday,
    useSetupProgress,
    useStaffToday,
    useTodayActions,
    BUSINESS_CURRENCY,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop, Button, Empty, Notice, Panel, useTabletLayout } from "@clientbridge/ui";

import { DebugOverlay } from "../components/DebugOverlay";
import {
    AgendaRows,
    AttentionList,
    KpiSummary,
    KpiSummaryLoading,
    NextActions,
    NextCard,
    NumbersFailed,
    PaymentsSummary,
    QuietDay,
    QuietSchedule,
    RowsLoading,
    Section,
    SetupGuide,
    TeamToday,
    TodayFailed,
    TodayHeader,
} from "../components/TodayParts";
import { CheckInLayer } from "../components/CheckInSheet";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { bookUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const t = strings.today;

export function TodayScreen() {
    const viewer = useViewer();
    const notifications = useNotifications(viewer);
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
            <Backdrop />
            <StatusBar style="dark" />
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
    const owner = useOwnerToday(api, viewer);
    const { load, view } = owner;
    const actions = useTodayActions(api);
    const openLink = useOpenLink();
    const setup = useSetupProgress();
    const bookingLink = setup.slug === null ? null : bookingPageUrl(bookUrl, setup.slug);
    const loading = load.state === "loading";
    const layout = firstRunLayout(
        view.agenda.length,
        owner.moneyLoad.state === "ready" ? owner.money : null,
        setup,
    );
    const firstRun = load.hasData && layout.guide;
    const figures = !(firstRun && !layout.money);
    const focus = view.current ?? view.next;
    const wide = useTabletLayout();
    // A tablet has room for the whole day, done visits included, as on the web.
    const later = wide ? view.agenda : view.agenda.filter((a) => a !== focus && a.state !== "done");
    const focusSection =
        focus === null ? null : (
            <Section title={focus.state === "now" ? t.stateNow : t.upNext}>
                <NextCard item={focus}>
                    <NextActions item={focus} actions={actions} />
                </NextCard>
            </Section>
        );
    const attentionSection =
        firstRun && view.attention.length === 0 ? null : (
            <Section title={t.needsYou}>
                {loading ? (
                    <RowsLoading count={3} />
                ) : (
                    <AttentionList items={view.attention} actions={actions} empty={t.allClear} />
                )}
            </Section>
        );
    const scheduleSection = (
        <Section
            title={wide ? t.schedule : t.restOfDay}
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
            ) : firstRun ? (
                <QuietSchedule bookingLink={bookingLink} />
            ) : later.length === 0 ? (
                <QuietDay bookingLink={bookingLink} />
            ) : (
                <AgendaRows items={later} />
            )}
        </Section>
    );

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
                    <CheckInLayer actions={actions} />
                    {firstRun ? <SetupGuide setup={setup} /> : null}
                    {!figures ? null : loading || owner.moneyLoad.state === "loading" ? (
                        <KpiSummaryLoading />
                    ) : owner.moneyLoad.state === "error" ? (
                        <View style={styles.notice}>
                            <NumbersFailed
                                onRetry={owner.moneyLoad.retry}
                                retrying={owner.moneyLoad.retrying}
                            />
                        </View>
                    ) : (
                        <KpiSummary
                            items={[
                                {
                                    label: t.booked,
                                    value: String(view.agenda.length),
                                    hint: t.bookedHint(view.done, view.remaining),
                                    progress: { value: view.done, max: view.agenda.length },
                                },
                                {
                                    label: t.expected,
                                    value: formatMoney(view.expectedCents, BUSINESS_CURRENCY),
                                    hint: t.expectedHint,
                                },
                                {
                                    label: t.collected,
                                    value: formatMoney(
                                        owner.money.collectedCents,
                                        BUSINESS_CURRENCY,
                                    ),
                                    hint: t.collectedHint(owner.money.paymentCount),
                                    tone: "success",
                                },
                                {
                                    label: t.awaiting,
                                    value: formatMoney(
                                        owner.money.awaitingCents,
                                        BUSINESS_CURRENCY,
                                    ),
                                    hint: t.awaitingHint(owner.money.awaitingCount),
                                },
                            ]}
                        />
                    )}
                    {wide && !firstRun ? (
                        <View style={styles.columns}>
                            <View style={styles.main}>
                                {focusSection}
                                {scheduleSection}
                            </View>
                            <View style={styles.side}>
                                {figures ? <PaymentsSummary owner /> : null}
                                {attentionSection}
                                <TeamToday team={view.team} />
                            </View>
                        </View>
                    ) : (
                        <>
                            {focusSection}
                            {figures ? <PaymentsSummary owner /> : null}
                            {attentionSection}
                            {scheduleSection}
                        </>
                    )}
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
                    <CheckInLayer actions={actions} />
                    <Section title={t.staff.nextClient}>
                        {next === null ? (
                            <Panel flush>
                                <Empty
                                    icon="calendar"
                                    message={
                                        view.agenda.length === 0
                                            ? t.staff.subtitle(0)
                                            : t.staff.noNext
                                    }
                                    body={t.staff.noNextBody}
                                />
                            </Panel>
                        ) : (
                            <NextCard item={next}>
                                <NextActions item={next} actions={actions} />
                            </NextCard>
                        )}
                    </Section>
                    <PaymentsSummary />
                    <View style={styles.facts}>
                        <Panel style={styles.fact}>
                            <Text style={styles.factLabel}>{t.staff.earnings}</Text>
                            <Text style={[styles.factValue, { color: c.success }]}>
                                {formatMoney(day.earnedCents, BUSINESS_CURRENCY)}
                            </Text>
                            <Text style={styles.factHint}>{t.staff.earningsHint}</Text>
                        </Panel>
                        <Panel style={styles.fact}>
                            <Text style={styles.factLabel}>{t.staff.hours}</Text>
                            <Text style={styles.factValue}>{day.hours ?? t.teamOff}</Text>
                            <Text style={styles.factHint}>
                                {t.staff.tomorrow}: {t.teamCount(day.tomorrow)}
                            </Text>
                        </Panel>
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
    screen: { flex: 1 },
    body: { paddingTop: 4, paddingBottom: 32 },
    notice: { paddingHorizontal: 20, paddingBottom: 10 },
    loading: { paddingHorizontal: 20, paddingTop: 12 },
    sub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14, paddingHorizontal: 20 },
    facts: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginTop: 22 },
    columns: { flexDirection: "row", alignItems: "flex-start" },
    // Each section pads its own sides, so the columns overlap that padding to leave a 24pt gap.
    main: { flex: 1, minWidth: 0, marginRight: -8 },
    side: { width: 360, marginLeft: -8 },
    fact: { flex: 1 },
    factLabel: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "600" },
    factValue: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 18,
        fontWeight: "700",
        marginTop: 4,
    },
    factHint: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        marginTop: 3,
        lineHeight: 16,
    },
});
