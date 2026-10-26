import {
    type SubjectCard,
    type SubjectRow,
    formatDate,
    relativeDay,
    strings,
    useSubjectCards,
    useSubjectPhotos,
    useBusinessZone,
    SUBJECT_ICON,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Panel,
    Skeleton,
} from "@clientbridge/ui";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

import type { RootStackParamList } from "../navigation";
import { PhotoGrid } from "../components/BookingSheet";
import { SubjectSheet } from "../components/ClientSheets";

const c = theme.colors;
const sj = strings.subjects;

function SubjectCardView({ card, onPress }: { card: SubjectCard; onPress: () => void }) {
    const zone = useBusinessZone();
    const photos = useSubjectPhotos(api, card.subject.id);
    const alerts = card.alerts.filter((a) => a.key !== "temp");
    return (
        <Panel flush>
            <ListRow
                leading={<Avatar name={card.subject.name} size="lg" />}
                title={card.subject.name}
                detail={card.line}
                meta={
                    card.temperament !== null ? (
                        <Badge
                            label={card.temperament.label}
                            intent={card.temperament.nervous ? "warning" : "neutral"}
                        />
                    ) : undefined
                }
                label={sj.editNamed(card.subject.name)}
                onPress={onPress}
            />
            {alerts.map((a) => (
                <View
                    key={a.key}
                    style={[
                        styles.alert,
                        { backgroundColor: a.intent === "danger" ? c.danBg : c.warnBg },
                    ]}
                >
                    <Icon
                        name="alert"
                        size={14}
                        color={a.intent === "danger" ? c.danFg : c.warnFg}
                    />
                    <Text
                        style={[
                            styles.alertText,
                            { color: a.intent === "danger" ? c.danFg : c.warnFg },
                        ]}
                    >
                        {a.label}
                    </Text>
                </View>
            ))}
            {card.equipment.length > 0 ? (
                <View style={styles.equipment}>
                    <Text style={styles.statLabel}>{sj.equipment.title}</Text>
                    {card.equipment.map((line) => (
                        <View key={line.key} style={styles.device}>
                            <View style={styles.deviceText}>
                                <Text style={styles.statValue} numberOfLines={1}>
                                    {line.model}
                                </Text>
                                {line.detail !== "" ? (
                                    <Text style={styles.statLabel} numberOfLines={1}>
                                        {line.detail}
                                    </Text>
                                ) : null}
                            </View>
                            {line.warranty !== null ? (
                                <Badge label={line.warranty} intent={line.intent} />
                            ) : null}
                        </View>
                    ))}
                </View>
            ) : null}
            {photos.length > 0 ? (
                <View style={styles.equipment}>
                    <Text style={styles.statLabel}>{sj.photos}</Text>
                    <PhotoGrid photos={photos} />
                </View>
            ) : null}
            <View style={styles.stats}>
                <Stat label={sj.visits} value={String(card.visits)} />
                <Stat
                    label={sj.lastVisit}
                    value={
                        card.lastVisit === null
                            ? strings.clients.dash
                            : formatDate(card.lastVisit, zone)
                    }
                />
                <Stat
                    label={sj.nextVisit}
                    value={card.next === null ? sj.nothingBooked : relativeDay(card.next, zone)}
                />
            </View>
        </Panel>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.stat}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

/** A client's subjects as cards; tapping one opens its sheet. */
export function ClientSubjectsScreen() {
    const { clientId, kind } = useRoute<RouteProp<RootStackParamList, "ClientSubjects">>().params;
    const { load, cards } = useSubjectCards(clientId);
    const [editing, setEditing] = useState<{ subject: SubjectRow | null } | null>(null);
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                {load.state === "loading" ? (
                    <Skeleton variant="row" count={3} label={sj.loading(kind)} />
                ) : null}
                {load.state === "error" ? (
                    <LoadFailed
                        message={sj.loadError(kind)}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                ) : null}
                {load.hasData && cards.length === 0 ? (
                    <Empty
                        icon={SUBJECT_ICON[kind]}
                        message={sj.noneTitle(kind)}
                        body={sj.noneBody(kind)}
                    />
                ) : null}
                {cards.map((card) => (
                    <SubjectCardView
                        key={card.subject.id}
                        card={card}
                        onPress={() => {
                            setEditing({ subject: card.subject });
                        }}
                    />
                ))}
                {load.hasData ? (
                    <Button
                        full
                        variant="outline"
                        icon={SUBJECT_ICON[kind]}
                        onPress={() => {
                            setEditing({ subject: null });
                        }}
                    >
                        {sj.add(kind)}
                    </Button>
                ) : null}
            </ScrollView>
            {editing !== null ? (
                <SubjectSheet
                    key={editing.subject?.id ?? "new"}
                    clientId={clientId}
                    subject={editing.subject}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    alert: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginHorizontal: 14,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: theme.radius,
    },
    alertText: { fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "600", flexShrink: 1 },
    stats: {
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    stat: { flex: 1, minWidth: 0 },
    equipment: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
    },
    device: { flexDirection: "row", alignItems: "center", gap: 8 },
    deviceText: { flex: 1, minWidth: 0 },
    statLabel: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 11 },
    statValue: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontWeight: "600",
        marginTop: 2,
    },
});
