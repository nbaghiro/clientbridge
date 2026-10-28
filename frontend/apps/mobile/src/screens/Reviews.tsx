import {
    type ReviewQueue,
    formatDate,
    parseTimestamp,
    strings,
    usePeoplePhotos,
    useRequestReview,
    useReviewAutomation,
    useReviewQueue,
    useGoogleReviews,
    useBusinessZone,
} from "@clientbridge/app-core";
import { Linking } from "react-native";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Modal,
    Notice,
    Panel,
    Select,
    SearchSelect,
    SheetHeader,
    Stars,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
const c = theme.colors;
const s = strings.reviews;
const dateOf = (value: string, zone: string): string => formatDate(parseTimestamp(value), zone);

export function Reviews() {
    const google = useGoogleReviews(api);
    const queue = useReviewQueue(google.canRequest);
    const automation = useReviewAutomation(api);
    const [asking, setAsking] = useState(false);
    const connect = () => {
        google.connect(
            "native",
            (url) => {
                WebBrowser.openAuthSessionAsync(url, "clientbridge://reviews/google")
                    .then((result) => {
                        if (result.type !== "success") google.cancelConnect();
                    })
                    .catch(() => {
                        google.cancelConnect();
                    });
            },
            () => {
                WebBrowser.dismissAuthSession();
            },
        );
    };
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.subtitle}>{s.subtitle}</Text>
                {google.loading ? <Notice tone="info">{s.loading}</Notice> : null}
                {google.error !== null ? <Notice tone="danger">{google.error}</Notice> : null}
                {!google.loading && google.error !== null && google.busy === null ? (
                    <Button onPress={google.refresh}>{s.retry}</Button>
                ) : null}
                {google.connection?.state === "unavailable" ? (
                    <Panel>
                        <Empty icon="star" message={s.unavailableTitle} body={s.unavailable} />
                    </Panel>
                ) : null}
                {google.connection?.state === "disconnected" ||
                google.connection?.state === "reconnect_required" ? (
                    <Panel>
                        <Empty
                            icon="star"
                            message={
                                google.connection.state === "reconnect_required"
                                    ? s.reconnectTitle
                                    : s.connectTitle
                            }
                            body={
                                google.connection.state === "reconnect_required"
                                    ? s.reconnectBody
                                    : s.connectBody
                            }
                        />
                        <Button busy={google.busy === "connect"} onPress={connect}>
                            {google.connection.state === "reconnect_required"
                                ? s.reconnect
                                : s.connect}
                        </Button>
                        <Button
                            variant="outline"
                            onPress={() => {
                                Linking.openURL("https://www.google.com/business/").catch(
                                    () => undefined,
                                );
                            }}
                        >
                            {s.profileHelp}
                        </Button>
                    </Panel>
                ) : null}
                {google.connection?.state === "active" && google.error !== null ? (
                    <Button variant="outline" disabled={google.busy !== null} onPress={connect}>
                        {s.changeAccount}
                    </Button>
                ) : null}
                {google.busy === "connect" ? (
                    <Panel style={styles.card}>
                        <Text style={styles.meta}>{s.authorizationWaiting}</Text>
                        <Button variant="outline" onPress={google.cancelConnect}>
                            {s.cancel}
                        </Button>
                    </Panel>
                ) : null}
                {google.connection?.state === "selecting" ? (
                    <Panel
                        title={s.chooseProfile}
                        subtitle={s.chooseProfileBody}
                        style={styles.card}
                    >
                        <Select
                            label={s.googleAccount}
                            value={google.account}
                            disabled={google.busy !== null}
                            options={[
                                { key: "", label: s.chooseAccount },
                                ...google.accountOptions,
                            ]}
                            onChange={google.chooseAccount}
                        />
                        {google.accountOptions.length === 0 && !google.loading ? (
                            <Notice tone="info">{s.noAccounts}</Notice>
                        ) : null}
                        {google.moreAccounts ? (
                            <Button
                                variant="outline"
                                busy={google.busy === "accounts"}
                                onPress={google.loadAccounts}
                            >
                                {s.moreAccounts}
                            </Button>
                        ) : null}
                        {google.account !== "" ? (
                            <Select
                                label={s.googleLocation}
                                value={google.location}
                                disabled={google.busy !== null}
                                options={[
                                    { key: "", label: s.chooseLocation },
                                    ...google.locationOptions,
                                ]}
                                onChange={google.setLocation}
                            />
                        ) : null}
                        {google.account !== "" &&
                        google.locationOptions.length === 0 &&
                        google.busy === null ? (
                            <Notice tone="info">{s.noLocations}</Notice>
                        ) : null}
                        {google.moreLocations ? (
                            <Button
                                variant="outline"
                                busy={google.busy === "locations"}
                                onPress={google.loadLocations}
                            >
                                {s.moreLocations}
                            </Button>
                        ) : null}
                        <Button
                            disabled={google.location === "" || google.busy !== null}
                            busy={google.busy === "select"}
                            onPress={google.selectLocation}
                        >
                            {s.useLocation}
                        </Button>
                        <Button variant="outline" disabled={google.busy !== null} onPress={connect}>
                            {s.changeAccount}
                        </Button>
                    </Panel>
                ) : null}
                {google.connected ? (
                    <>
                        <Panel title={google.connection?.location?.title} style={styles.card}>
                            <Text style={styles.sheetBody}>{google.summary}</Text>
                            <Text style={styles.meta}>{s.attribution}</Text>
                            <Button
                                variant="outline"
                                disabled={google.busy !== null}
                                onPress={google.refresh}
                            >
                                {s.refresh}
                            </Button>
                        </Panel>
                        {google.reviews.length === 0 ? (
                            <Panel>
                                <Empty
                                    icon="star"
                                    message={s.noGoogleReviewsTitle}
                                    body={s.noGoogleReviews}
                                />
                            </Panel>
                        ) : null}
                        {google.reviews.map((review) => (
                            <Panel key={review.review_id} style={styles.card}>
                                <Text style={styles.rowName}>{review.author}</Text>
                                <Stars value={review.stars} />
                                <Text style={styles.meta}>{review.date}</Text>
                                <Text style={styles.sheetBody}>
                                    {review.comment ?? s.ratingOnly}
                                </Text>
                                {review.reply ? (
                                    <View style={styles.reply}>
                                        <Text style={styles.section}>{s.ownerReply}</Text>
                                        <Text style={styles.sheetBody}>{review.reply.comment}</Text>
                                    </View>
                                ) : null}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={google.busy !== null}
                                    onPress={() => {
                                        google.editReply(review);
                                    }}
                                >
                                    {review.reply ? s.editReply : s.reply}
                                </Button>
                            </Panel>
                        ))}
                        {google.moreReviews ? (
                            <Button
                                variant="outline"
                                busy={google.busy === "more"}
                                onPress={google.loadMore}
                            >
                                {s.moreReviews}
                            </Button>
                        ) : null}
                        <Loaded
                            flush
                            load={queue.load}
                            loading={s.requestsLoading}
                            failed={s.loadError}
                        >
                            <Toggle
                                label={s.automation}
                                hint={s.automationHint}
                                value={automation.enabled}
                                disabled={automation.busy}
                                onChange={automation.setEnabled}
                            />
                            {automation.error !== null ? (
                                <Notice tone="danger">{automation.error}</Notice>
                            ) : null}
                            <Button
                                icon="send"
                                disabled={!google.canRequest}
                                onPress={() => {
                                    setAsking(true);
                                }}
                            >
                                {s.requestReview}
                            </Button>
                            {!google.canRequest ? (
                                <Notice tone="info">{s.invitationUnavailable}</Notice>
                            ) : null}
                            <AskList queue={queue} />
                        </Loaded>
                    </>
                ) : null}
                {google.connection !== null &&
                !["unavailable", "disconnected"].includes(google.connection.state) ? (
                    <Button
                        variant="outline"
                        disabled={google.busy !== null}
                        onPress={() => {
                            google.setConfirm("disconnect");
                        }}
                    >
                        {s.disconnect}
                    </Button>
                ) : null}
            </ScrollView>
            {google.reply !== null ? (
                <Modal open onClose={google.closeReply}>
                    <View style={styles.sheet}>
                        <SheetHeader title={s.replyTitle} />
                        <Text style={styles.meta}>{s.replyPublic}</Text>
                        <TextField
                            label={s.replyText}
                            multiline
                            value={google.comment}
                            disabled={google.busy === "reply"}
                            onChange={google.setComment}
                        />
                        {google.error !== null ? (
                            <Notice tone="danger">{google.error}</Notice>
                        ) : null}
                        {google.pendingReply ? <Notice tone="info">{s.replyPending}</Notice> : null}
                        <Button
                            busy={google.busy === "reply"}
                            disabled={google.comment.trim() === ""}
                            onPress={google.sendReply}
                        >
                            {s.publishReply}
                        </Button>
                        {google.reply.reply ? (
                            <Button
                                variant="outline"
                                disabled={google.busy !== null}
                                onPress={() => {
                                    google.setConfirm("deleteReply");
                                }}
                            >
                                {s.deleteReply}
                            </Button>
                        ) : null}
                        <Button
                            variant="outline"
                            disabled={google.busy === "reply"}
                            onPress={google.closeReply}
                        >
                            {s.cancel}
                        </Button>
                        {google.confirm === "deleteReply" ? (
                            <>
                                <Notice tone="info">{s.deleteReplyBody}</Notice>
                                <Button busy={google.busy !== null} onPress={google.deleteReply}>
                                    {s.confirm}
                                </Button>
                                <Button
                                    variant="outline"
                                    onPress={() => {
                                        google.setConfirm(null);
                                    }}
                                >
                                    {s.cancel}
                                </Button>
                            </>
                        ) : null}
                    </View>
                </Modal>
            ) : null}
            {google.confirm === "disconnect" ? (
                <Modal
                    open
                    onClose={() => {
                        google.setConfirm(null);
                    }}
                >
                    <View style={styles.sheet}>
                        <SheetHeader title={s.disconnect} />
                        <Text style={styles.sheetBody}>{s.disconnectBody}</Text>
                        <Button busy={google.busy !== null} onPress={google.disconnect}>
                            {s.confirm}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={google.busy !== null}
                            onPress={() => {
                                google.setConfirm(null);
                            }}
                        >
                            {s.cancel}
                        </Button>
                    </View>
                </Modal>
            ) : null}
            {asking && google.canRequest ? (
                <RequestReviewSheet
                    queue={queue}
                    onClose={() => {
                        setAsking(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function AskList({ queue }: { queue: ReviewQueue }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const req = useRequestReview(api);
    return (
        <Panel style={styles.card}>
            <Text style={styles.section}>{s.askTitle}</Text>
            <Text style={styles.meta}>{s.askSubtitle}</Text>
            {queue.suggestions.length === 0 ? <Text style={styles.meta}>{s.askEmpty}</Text> : null}
            {queue.suggestions.map((x) => (
                <View key={x.bookingId} style={styles.row}>
                    <Avatar name={x.clientName} src={photos.client(x.clientId)} size="sm" />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{x.clientName}</Text>
                        <Text style={styles.meta}>{x.visit}</Text>
                    </View>
                    {req.sent.has(x.bookingId) ? (
                        <Badge style={{ alignSelf: "center" }} label={s.asked} intent="success" />
                    ) : (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="outline"
                            busy={req.busyId === x.bookingId}
                            disabled={!queue.canRequest}
                            onPress={() => {
                                req.request(x.clientId, x.bookingId);
                            }}
                        >
                            {s.ask}
                        </Button>
                    )}
                </View>
            ))}
            <Text style={[styles.section, styles.sectionGap]}>{s.requestsTitle}</Text>
            {queue.requests.length === 0 ? <Text style={styles.meta}>{s.noRequests}</Text> : null}
            {queue.requests.map((r) => (
                <View key={r.id} style={styles.row}>
                    <Avatar
                        name={r.client_name ?? s.clientFallback}
                        src={photos.client(r.client_id)}
                        size="sm"
                    />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{r.client_name ?? s.clientFallback}</Text>
                        <Text style={styles.meta}>
                            {s.requestedOn(dateOf(r.requested_at, zone))}
                        </Text>
                    </View>
                </View>
            ))}
            {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
        </Panel>
    );
}

function RequestReviewSheet({ queue, onClose }: { queue: ReviewQueue; onClose: () => void }) {
    const req = useRequestReview(api);
    const [clientId, setClientId] = useState(queue.suggestions[0]?.clientId ?? "");
    const name = queue.clientOptions.find((o) => o.key === clientId)?.label ?? "";
    const sent = clientId !== "" && req.sent.has(clientId);
    return (
        <Modal open onClose={onClose}>
            <View style={styles.sheet}>
                <SheetHeader title={s.requestTitle} />
                <Text style={styles.sheetBody}>{s.requestBody}</Text>
                <SearchSelect
                    label={s.requestClient}
                    value={clientId}
                    placeholder={s.chooseClient}
                    options={queue.clientOptions}
                    onChange={setClientId}
                />
                {sent ? <Notice tone="success">{s.requestSent(name)}</Notice> : null}
                {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
                <View style={styles.sheetActions}>
                    <View style={styles.flex}>
                        <Button full variant="outline" onPress={onClose}>
                            {sent ? s.done : s.cancel}
                        </Button>
                    </View>
                    <View style={styles.flex}>
                        <Button
                            full
                            disabled={clientId === "" || sent || !queue.canRequest}
                            busy={req.busyId === clientId}
                            onPress={() => {
                                req.request(clientId);
                            }}
                        >
                            {s.requestSend}
                        </Button>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    reply: { gap: 6, padding: 12, backgroundColor: c.bg, borderRadius: theme.radius },
    screen: { flex: 1 },
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 12 },
    subtitle: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    card: { gap: 10 },
    flex: { flex: 1, minWidth: 0 },
    meta: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 2 },
    section: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    sectionGap: { marginTop: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    rowName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    sheet: { gap: 14 },
    sheetBody: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20 },
    sheetActions: { flexDirection: "row", gap: 10 },
});
