import {
    type TodayActions,
    formatParts,
    strings,
    useCheckIn,
    useSubjectKind,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";
import { Button, Modal, Notice, SheetHeader, Skeleton, StatusPill } from "@clientbridge/ui";
import * as WebBrowser from "expo-web-browser";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { bookUrl } from "../lib/config";

const c = theme.colors;
const t = strings.today;

/** The open check-in sheet and the short line that confirms a check-in. */
export function CheckInLayer({ actions }: { actions: TodayActions }) {
    return (
        <>
            {actions.notice !== null ? (
                <View style={styles.notice}>
                    <Notice tone="success" banner>
                        {actions.notice}
                    </Notice>
                    {actions.undoCheckIn === null ? null : (
                        <Button size="sm" variant="outline" onPress={actions.undoCheckIn}>
                            {t.undoCheckIn}
                        </Button>
                    )}
                </View>
            ) : null}
            {actions.checkingIn !== null ? (
                <CheckInSheet
                    bookingId={actions.checkingIn}
                    onClose={actions.closeCheckIn}
                    onDone={actions.checkedIn}
                />
            ) : null}
        </>
    );
}

export function CheckInSheet({
    bookingId,
    onClose,
    onDone,
}: {
    bookingId: string;
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    const kind = useSubjectKind();
    const ci = useCheckIn(api, bookingId, kind, useViewer(), onDone);
    const v = ci.visit;
    return (
        <Modal size="lg" onClose={onClose}>
            <View style={styles.body}>
                <SheetHeader title={ci.title} onClose={onClose} />
                {v === null ? (
                    <Skeleton variant="row" count={2} label={t.loading} />
                ) : (
                    <>
                        <View style={styles.who}>
                            <Text style={styles.name}>
                                {formatParts([v.subjectName, v.clientName])}
                            </Text>
                            <Text style={styles.sub}>
                                {formatParts([
                                    v.serviceName,
                                    v.time,
                                    v.staffName === null ? null : t.withStaff(v.staffName),
                                ])}
                            </Text>
                            {v.temperament === null ? null : (
                                <Text style={styles.sub}>
                                    {t.checkInTemperament(v.temperament)}
                                </Text>
                            )}
                        </View>
                        {v.alerts.length > 0 ? (
                            <View style={styles.who}>
                                <Text style={styles.label}>{t.checkInWatch}</Text>
                                <View style={styles.alerts}>
                                    {v.alerts.map((a) => (
                                        <StatusPill
                                            key={a.key}
                                            status={a.label}
                                            intent={a.intent}
                                        />
                                    ))}
                                </View>
                            </View>
                        ) : null}
                        {ci.needs.length > 0 ? (
                            <View style={styles.who}>
                                <Text style={styles.label}>{t.checkInNeeds}</Text>
                                {ci.needs.map((n) => (
                                    <View key={n.key} style={styles.need}>
                                        <Text style={styles.needLabel} numberOfLines={2}>
                                            {n.label}
                                        </Text>
                                        {n.openPath === null ? null : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onPress={() => {
                                                    const path = n.openPath;
                                                    if (path === null) return;
                                                    WebBrowser.openBrowserAsync(`${bookUrl}${path}`)
                                                        .then(ci.refreshNeeds)
                                                        .catch(() => undefined);
                                                }}
                                            >
                                                {t.needOpen}
                                            </Button>
                                        )}
                                        {n.canSend ? (
                                            <Button
                                                size="sm"
                                                variant="quiet"
                                                busy={n.sending}
                                                onPress={n.send}
                                            >
                                                {n.openPath === null ? t.needSend : t.needResend}
                                            </Button>
                                        ) : null}
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </>
                )}
                {ci.error !== null ? <Notice tone="danger">{ci.error}</Notice> : null}
                <Button full busy={ci.busy} disabled={v === null} onPress={ci.submit}>
                    {ci.title}
                </Button>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    notice: { marginBottom: 12, gap: 8 },
    body: { gap: 16 },
    who: { gap: 4 },
    name: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 16, fontWeight: "600" },
    sub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20 },
    label: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "600" },
    alerts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    need: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
    needLabel: { flex: 1, color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14 },
});
