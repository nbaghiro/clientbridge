import {
    formatMoney,
    payoutStatusIntent,
    strings,
    useAsyncAction,
    usePayouts,
    usePaymentAccount,
    useSetupProgress,
    formatParts,
    BUSINESS_CURRENCY,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    PaymentAccount,
    DetailSection,
    DetailView,
    Empty,
    KeyValueList,
    ListRow,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    Stat,
    StatusPill,
    ui,
} from "@clientbridge/ui";
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { publicWebUrl } from "../lib/config";
import { useOpenLink } from "../lib/links";

const s = strings.payouts;
const c = theme.colors;

export function Payouts() {
    const p = usePayouts(api);
    const account = usePaymentAccount(api);
    const setup = useSetupProgress();
    const connected = setup.steps.find((x) => x.key === "stripe")?.done ?? false;
    const openLink = useOpenLink();
    const web = useAsyncAction();
    const manageOnWeb = (): void => {
        web.run(
            () =>
                Linking.openURL(
                    `${publicWebUrl.replace(/\/$/, "")}/setup/getting-paid?manage=account`,
                ),
            { errorMessage: strings.paymentAccount.webError },
        );
    };
    const [open, setOpen] = useState(false);
    const sel = p.selected;
    if (account.props !== null) return <PaymentAccount {...account.props} />;
    if (p.load.state === "empty" && !connected) {
        return (
            <View style={styles.screen}>
                <ScrollView contentContainerStyle={styles.page}>
                    <Empty
                        variant="card"
                        icon="bank"
                        message={strings.business.getSetUp.tasks.stripe.label}
                        body={strings.business.getSetUp.fresh.stripe}
                        actions={
                            <Button
                                size="sm"
                                onPress={() => {
                                    openLink("gettingPaid");
                                }}
                            >
                                {strings.business.getSetUp.start}
                            </Button>
                        }
                    />
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.page}>
                <Button variant="outline" icon="external" busy={web.busy} onPress={manageOnWeb}>
                    {strings.paymentAccount.manageOnWeb}
                </Button>
                {web.error !== null ? <Notice tone="danger">{web.error}</Notice> : null}
                <Button
                    disabled={!account.ready}
                    variant="outline"
                    onPress={() => {
                        account.open("payouts");
                    }}
                >
                    {strings.paymentAccount.viewPayouts}
                </Button>
                {p.load.state === "loading" ? (
                    <Skeleton variant="row" count={5} label={s.loading} />
                ) : p.load.state === "error" ? (
                    <LoadFailed
                        variant="card"
                        message={s.loadError}
                        onRetry={p.load.retry}
                        retrying={p.load.retrying}
                    />
                ) : p.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="bank"
                        message={s.noPayouts}
                        body={s.noPayoutsBody}
                    />
                ) : (
                    <>
                        <Text style={ui.note}>{s.subtitle}</Text>
                        <Panel>
                            <View style={styles.stats}>
                                <Stat
                                    currency={BUSINESS_CURRENCY}
                                    label={s.inStripe}
                                    cents={p.balanceCents}
                                />
                                <Stat
                                    currency={BUSINESS_CURRENCY}
                                    label={s.deposited}
                                    cents={p.depositedCents}
                                    tone="success"
                                />
                                <Stat
                                    currency={BUSINESS_CURRENCY}
                                    label={s.fees}
                                    cents={p.feesCents}
                                    hint={s.depositedHint}
                                />
                            </View>
                        </Panel>
                        <Panel flush>
                            {p.historyLoad.state === "loading" ? (
                                <Skeleton variant="row" count={3} label={s.loading} />
                            ) : p.historyLoad.state === "error" ? (
                                <LoadFailed
                                    message={s.loadError}
                                    onRetry={p.historyLoad.retry}
                                    retrying={p.historyLoad.retrying}
                                />
                            ) : p.payouts.length === 0 ? (
                                <Empty message={s.noPayouts} body={s.noPayoutsBody} />
                            ) : (
                                p.payouts.map((row) => (
                                    <ListRow
                                        key={row.id}
                                        icon={row.status === "failed" ? "alert" : "bank"}
                                        intent={row.status === "failed" ? "danger" : "neutral"}
                                        title={formatMoney(row.amountCents, BUSINESS_CURRENCY)}
                                        detail={row.when}
                                        meta={
                                            <StatusPill
                                                status={s.status[row.status]}
                                                intent={payoutStatusIntent(row.status)}
                                            />
                                        }
                                        onPress={() => {
                                            p.select(row.id);
                                            setOpen(true);
                                        }}
                                    />
                                ))
                            )}
                            {p.previous !== null ? (
                                <Button variant="outline" onPress={p.previous}>
                                    {s.historyPrevious}
                                </Button>
                            ) : null}
                            {p.next !== null ? (
                                <Button variant="outline" onPress={p.next}>
                                    {s.historyNext}
                                </Button>
                            ) : null}
                        </Panel>
                        <Text style={styles.caption}>{s.chargesTitle}</Text>
                        <Panel flush>
                            {p.charges.length === 0 ? (
                                <Empty message={s.noCharges} />
                            ) : (
                                p.charges.map((ch) => (
                                    <ListRow
                                        key={ch.id}
                                        density="compact"
                                        title={ch.client}
                                        detail={formatParts([
                                            ch.description,
                                            ch.refundedCents > 0
                                                ? s.refunded(
                                                      formatMoney(
                                                          ch.refundedCents,
                                                          BUSINESS_CURRENCY,
                                                      ),
                                                  )
                                                : null,
                                        ])}
                                        meta={
                                            ch.feeCents === null ? (
                                                <Badge label={s.feePending} intent="warning" />
                                            ) : (
                                                formatMoney(ch.netCents, BUSINESS_CURRENCY)
                                            )
                                        }
                                    />
                                ))
                            )}
                        </Panel>
                        {p.feesPending > 0 ? <Text style={ui.note}>{s.feePendingHint}</Text> : null}
                    </>
                )}
            </ScrollView>
            {open && sel !== null ? (
                <DetailView
                    open
                    title={formatMoney(sel.amountCents, BUSINESS_CURRENCY)}
                    subtitle={sel.when}
                    onClose={() => {
                        setOpen(false);
                    }}
                >
                    {sel.status === "failed" ? (
                        <Notice tone="danger" banner>
                            {s.returnedNotice}
                        </Notice>
                    ) : null}
                    <DetailSection>
                        {sel.ref !== null ? (
                            <KeyValueList rows={[{ label: s.payoutRef, value: sel.ref }]} />
                        ) : null}
                        <Panel flush title={s.contentsTitle}>
                            {p.contents.load.state === "loading" ? (
                                <Skeleton variant="row" count={3} label={s.loading} />
                            ) : p.contents.load.state === "error" ? (
                                <LoadFailed
                                    message={s.loadError}
                                    onRetry={p.contents.load.retry}
                                    retrying={p.contents.load.retrying}
                                />
                            ) : p.contents.status !== "available" ? (
                                <Notice tone="info" banner>
                                    {p.contents.status === "pending"
                                        ? s.contentsPending
                                        : s.contentsUnavailable}
                                </Notice>
                            ) : p.contents.rows.length === 0 ? (
                                <Empty message={s.contentsEmpty} />
                            ) : (
                                p.contents.rows.map((row) => (
                                    <ListRow
                                        key={row.id}
                                        title={row.title}
                                        detail={row.detail}
                                        meta={row.net}
                                    />
                                ))
                            )}
                            {p.contents.previous !== null ? (
                                <Button variant="outline" onPress={p.contents.previous}>
                                    {s.contentsPrevious}
                                </Button>
                            ) : null}
                            {p.contents.next !== null ? (
                                <Button variant="outline" onPress={p.contents.next}>
                                    {s.contentsNext}
                                </Button>
                            ) : null}
                        </Panel>
                    </DetailSection>
                </DetailView>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    stats: { gap: 12 },
    caption: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
});
