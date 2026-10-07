import {
    mediaUrl,
    strings,
    useAddonOffers,
    useBookingPolicy,
    useOnlineBookingSettings,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    CopyField,
    Empty,
    ItemImage,
    LoadFailed,
    Notice,
    PayCode,
    Skeleton,
    Stat,
    Tabs,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { apiUrl, bookUrl } from "../lib/config";

const c = theme.colors;
const s = strings.onlineBooking;
const p = s.policy;
const a = s.addons;

type Tab = "page" | "addons" | "policy";

/** Online booking on a phone: the page and its rules, add-ons offered at booking, and the policy. */
export function OnlineBookingScreen() {
    const [tab, setTab] = useState<Tab>("page");
    return (
        <View style={styles.screen}>
            <Tabs
                label={s.title}
                items={[
                    { key: "page", label: s.tabPage },
                    { key: "addons", label: s.tabAddons },
                    { key: "policy", label: p.title },
                ]}
                active={tab}
                onSelect={setTab}
            />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {tab === "page" ? <PageSettings /> : tab === "addons" ? <Addons /> : <Policy />}
            </ScrollView>
        </View>
    );
}

const share = (text: string): void => {
    Share.share({ message: text }).catch(() => undefined);
};

function Loading({
    state,
    retry,
    retrying,
}: {
    state: string;
    retry: () => void;
    retrying: boolean;
}) {
    if (state === "error")
        return <LoadFailed message={s.loadError} onRetry={retry} retrying={retrying} />;
    return <Skeleton variant="row" count={4} label={s.loading} />;
}

function PageSettings() {
    const st = useOnlineBookingSettings(api, bookUrl, {
        copy: share,
        share,
        open: (url) => {
            Linking.openURL(url).catch(() => undefined);
        },
    });
    if (!st.ready || st.policy === null)
        return <Loading state={st.load.state} retry={st.load.retry} retrying={st.load.retrying} />;
    const policy = st.policy;
    return (
        <>
            {st.bookableCount === 0 ? (
                <Notice tone="info" banner>{`${s.noneBookable}. ${s.noneBookableBody}`}</Notice>
            ) : null}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{s.share}</Text>
                <Text style={styles.muted}>{s.shareHint}</Text>
                <CopyField
                    label={s.link}
                    value={st.linkLabel}
                    copied={st.copied === "link"}
                    onCopy={() => {
                        st.copy("link", st.link);
                    }}
                    copyLabel={s.shareSheet}
                    copiedLabel={s.copied}
                />
                <View style={styles.qr}>
                    <PayCode value={st.link} size={120} label={s.qrLabel} />
                    <Text style={styles.muted}>{s.frontDeskHint}</Text>
                </View>
                <Button variant="outline" icon="external" onPress={st.openPage}>
                    {s.open}
                </Button>
            </View>
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{s.services}</Text>
                <Text style={styles.muted}>{s.servicesHint}</Text>
                {st.services.map((x) => (
                    <Toggle
                        key={x.id}
                        label={x.name}
                        hint={`${x.meta} · ${x.deposit}`}
                        value={x.bookable}
                        onChange={() => {
                            st.toggleService(x.id);
                        }}
                    />
                ))}
            </View>
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{s.team}</Text>
                <Text style={styles.muted}>{s.teamHint}</Text>
                {st.staff.map((x) => (
                    <View key={x.id} style={styles.rowGap}>
                        <Avatar name={x.name} size="sm" color={x.color} />
                        <View style={styles.flex}>
                            <Toggle
                                label={x.name}
                                hint={x.title}
                                value={x.online}
                                onChange={() => {
                                    st.toggleStaff(x.id);
                                }}
                            />
                        </View>
                    </View>
                ))}
            </View>
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{s.rules}</Text>
                <Text style={styles.label}>{s.leadTime}</Text>
                <Choice
                    label={s.leadTime}
                    options={st.leadOptions}
                    value={String(policy.lead_hours)}
                    onChange={(k) => {
                        st.setPolicy("lead_hours", Number(k));
                    }}
                />
                <Text style={styles.label}>{s.advance}</Text>
                <Choice
                    label={s.advance}
                    options={st.advanceOptions}
                    value={String(policy.horizon_days)}
                    onChange={(k) => {
                        st.setPolicy("horizon_days", Number(k));
                    }}
                />
                <Text style={styles.label}>{s.step}</Text>
                <Choice
                    label={s.step}
                    options={st.stepOptions}
                    value={String(policy.step_min ?? 0)}
                    onChange={(k) => {
                        st.setPolicy("step_min", Number(k) === 0 ? null : Number(k));
                    }}
                />
                <Text style={styles.label}>{s.newClients}</Text>
                <Choice
                    layout="segmented"
                    label={s.newClients}
                    value={policy.approve_new_clients ? "approve" : "allow"}
                    options={[
                        { key: "allow", label: s.newClientsAllow },
                        { key: "approve", label: s.newClientsApprove },
                    ]}
                    onChange={(k) => {
                        st.setPolicy("approve_new_clients", k === "approve");
                    }}
                />
            </View>
            {st.error !== null ? <Notice tone="danger">{st.error}</Notice> : null}
            {st.justSaved && !st.dirty ? <Notice tone="success">{s.saved}</Notice> : null}
            {st.dirty ? (
                <View style={styles.rowGap}>
                    <Button grow variant="outline" onPress={st.discard}>
                        {s.discard}
                    </Button>
                    <Button grow busy={st.busy} onPress={st.save}>
                        {s.save}
                    </Button>
                </View>
            ) : null}
        </>
    );
}

function Addons() {
    const o = useAddonOffers(api);
    if (o.load.state === "loading" || o.load.state === "error") {
        return <Loading state={o.load.state} retry={o.load.retry} retrying={o.load.retrying} />;
    }
    return (
        <>
            <Text style={styles.muted}>{a.subtitle}</Text>
            <View style={styles.card}>
                <Stat label={a.revenue} value={o.revenue} />
            </View>
            {o.offers.length === 0 ? (
                <Empty variant="card" icon="bag" message={a.emptyTitle} body={a.emptyBody} />
            ) : null}
            {o.offers.map((x) => (
                <View key={x.id} style={styles.card}>
                    <View style={styles.rowGap}>
                        <ItemImage
                            src={x.imageFileId !== null ? mediaUrl(apiUrl, x.imageFileId) : null}
                            name={x.name}
                            color={x.color}
                            size={44}
                        />
                        <View style={styles.flex}>
                            <Text style={styles.value}>{`${x.name} · ${x.price}`}</Text>
                            <Text style={styles.muted}>
                                {[x.stockLabel, x.addon ? x.attachLabel : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </Text>
                        </View>
                        {x.addon ? null : <Badge label={a.notOffered} intent="neutral" />}
                    </View>
                    <Toggle
                        label={a.offer}
                        value={x.addon}
                        onChange={() => {
                            o.toggle(x.id);
                        }}
                    />
                    {x.addon ? (
                        <>
                            <Text
                                style={styles.label}
                            >{`${a.pickServices} · ${x.scopeLabel}`}</Text>
                            <Choice
                                label={a.pickServices}
                                options={[{ key: "all", label: a.withEvery }, ...o.services]}
                                value={x.addonFor.length === 0 ? "all" : x.addonFor}
                                onChange={(k) => {
                                    if (k === "all") o.everyService(x.id);
                                    else o.toggleService(x.id, k);
                                }}
                            />
                        </>
                    ) : null}
                </View>
            ))}
            {o.error !== null ? <Notice tone="danger">{o.error}</Notice> : null}
            {o.justSaved && !o.dirty ? <Notice tone="success">{a.saved}</Notice> : null}
            {o.dirty ? (
                <Button full busy={o.busy} onPress={o.save}>
                    {a.save}
                </Button>
            ) : null}
        </>
    );
}

function Policy() {
    const pol = useBookingPolicy(api);
    const d = pol.policy;
    if (d === null)
        return (
            <Loading state={pol.load.state} retry={pol.load.retry} retrying={pol.load.retrying} />
        );
    return (
        <>
            <Text style={styles.muted}>{p.subtitle}</Text>
            <View style={styles.card}>
                <Toggle
                    label={p.selfService}
                    hint={p.selfServiceHint}
                    value={d.self_service}
                    onChange={(v) => {
                        pol.set("self_service", v);
                    }}
                />
                <Text style={styles.label}>{p.cancelCutoff}</Text>
                <Choice
                    label={p.cancelCutoff}
                    options={pol.cutoffOptions}
                    value={String(d.cancel_cutoff_hours)}
                    onChange={(k) => {
                        pol.set("cancel_cutoff_hours", Number(k));
                    }}
                />
                <Text style={styles.label}>{p.moveCutoff}</Text>
                <Choice
                    label={p.moveCutoff}
                    options={pol.cutoffOptions}
                    value={String(d.reschedule_cutoff_hours)}
                    onChange={(k) => {
                        pol.set("reschedule_cutoff_hours", Number(k));
                    }}
                />
                <Text style={styles.label}>{p.maxMoves}</Text>
                <Choice
                    layout="segmented"
                    label={p.maxMoves}
                    options={pol.maxMoveOptions}
                    value={String(d.max_reschedules)}
                    onChange={(k) => {
                        pol.set("max_reschedules", Number(k));
                    }}
                />
                <Text style={styles.label}>{p.lateDeposit}</Text>
                <Choice
                    layout="segmented"
                    label={p.lateDeposit}
                    value={d.late_cancel_deposit}
                    options={[
                        { key: "keep", label: p.keep },
                        { key: "refund", label: p.refund },
                    ]}
                    onChange={(k) => {
                        pol.set("late_cancel_deposit", k);
                    }}
                />
            </View>
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{p.clientSees}</Text>
                <Text style={styles.soft}>{pol.clientText}</Text>
            </View>
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{p.examples}</Text>
                {pol.examples.map((x) => (
                    <Text key={x.key} style={styles.soft}>{`• ${x.text}`}</Text>
                ))}
            </View>
            {pol.error !== null ? <Notice tone="danger">{pol.error}</Notice> : null}
            {pol.justSaved && !pol.dirty ? <Notice tone="success">{p.saved}</Notice> : null}
            {pol.dirty ? (
                <Button full busy={pol.busy} onPress={pol.save}>
                    {p.save}
                </Button>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 10,
    },
    cardTitle: { color: c.ink, fontSize: 16, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 13 },
    soft: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    value: { color: c.ink, fontSize: 14, fontWeight: "600" },
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginTop: 4 },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 10 },
    flex: { flex: 1, minWidth: 0 },
    qr: { alignItems: "center", gap: 8, paddingVertical: 8 },
});
