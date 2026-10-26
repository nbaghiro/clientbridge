import {
    type Enrolment,
    type ProgramBoard as Board,
    formatParts,
    kindWord,
    strings,
    useProgramBoard,
    useSubjectKind,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    confirm,
    Empty,
    ListRow,
    LoadFailed,
    Meter,
    Notice,
    Panel,
    SearchField,
    Skeleton,
} from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { RosterAttendee } from "./RosterAttendee";

const c = theme.colors;
const s = strings.programs;

/** Programs ahead, the chosen one's days with each day's roster, and who is enrolled. */
export function ProgramBoard({
    notice,
    onSchedule,
}: {
    notice: string | null;
    onSchedule: () => void;
}) {
    const board = useProgramBoard(api);
    return (
        <View style={styles.gap}>
            <Button size="sm" variant="outline" icon="plus" onPress={onSchedule}>
                {s.newProgram}
            </Button>
            {notice !== null ? <Notice tone="success">{notice}</Notice> : null}
            {board.load.state === "loading" ? (
                <Skeleton variant="row" count={4} label={s.loading} />
            ) : board.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={board.load.retry}
                    retrying={board.load.retrying}
                />
            ) : board.programs.length === 0 ? (
                <Empty variant="card" icon="calendar" message={s.emptyTitle} body={s.emptyBody} />
            ) : (
                <>
                    <Choice
                        layout="cards"
                        label={s.tab}
                        options={board.programs.map((p) => ({
                            key: p.id,
                            label: p.name,
                            hint: formatParts([p.dates, p.seatsLabel]),
                        }))}
                        value={board.selected}
                        onChange={board.select}
                    />
                    <ProgramDetail board={board} />
                </>
            )}
        </View>
    );
}

function ProgramDetail({ board }: { board: Board }) {
    const kind = useSubjectKind();
    const p = board.program;
    if (p === null) return null;
    const day = board.day;
    return (
        <View style={styles.gap}>
            <Panel style={styles.card}>
                <Text style={styles.title}>{p.name}</Text>
                <Text style={styles.muted}>{formatParts([p.dates, p.time, p.staffName])}</Text>
                <Text style={styles.muted}>
                    {formatParts([s.daysCount(p.days), p.price, s.enrolledCount(p.enrolled)])}
                </Text>
                {board.canCancelProgram ? (
                    <Button
                        size="sm"
                        variant="outline"
                        busy={board.busy}
                        onPress={() => {
                            confirm({
                                title: s.cancelProgramTitle(p.name),
                                message: s.cancelProgramBody,
                                confirmLabel: s.cancelProgram,
                                cancelLabel: s.keep,
                                destructive: true,
                            })
                                .then((ok) => {
                                    if (ok) board.cancelProgram();
                                })
                                .catch(() => undefined);
                        }}
                    >
                        {s.cancelProgram}
                    </Button>
                ) : null}
            </Panel>
            {board.notice !== null ? (
                <Notice tone="info" banner>
                    {board.notice}
                </Notice>
            ) : null}
            {board.error !== null ? <Notice tone="danger">{board.error}</Notice> : null}

            <Text style={styles.section}>{s.days}</Text>
            <Choice
                layout="chips"
                label={s.days}
                options={board.days.map((d) => ({
                    key: d.slotId,
                    label: d.label,
                    hint: formatParts([d.seatsLabel, d.room]),
                }))}
                value={day?.slotId ?? null}
                onChange={board.selectDay}
            />
            {day !== null ? (
                <>
                    <View style={styles.sectionRow}>
                        <Text style={styles.section}>{s.dayRoster(day.label)}</Text>
                        {day.started ? (
                            <Button
                                style={{ alignSelf: "center" }}
                                size="sm"
                                variant="link"
                                busy={board.busy}
                                onPress={board.checkInAll}
                            >
                                {strings.classes.checkInAll}
                            </Button>
                        ) : null}
                    </View>
                    <Meter
                        units
                        labelPosition="below"
                        value={day.booked}
                        max={day.capacity}
                        intent={day.full ? "warning" : "accent"}
                        label={formatParts([
                            strings.classes.seatsBooked(day.booked, day.capacity),
                            strings.classes.checkedIn(day.checkedIn, day.booked),
                        ])}
                    />
                    {!day.started ? <Text style={styles.muted}>{s.startsLater}</Text> : null}
                    <Panel flush>
                        {board.attendees.length === 0 ? (
                            <Text style={styles.empty}>{s.emptyDay}</Text>
                        ) : null}
                        {board.attendees.map((a, i) => (
                            <RosterAttendee
                                key={a.key}
                                a={a}
                                started={day.started}
                                actions={board}
                                first={i === 0}
                            />
                        ))}
                    </Panel>
                </>
            ) : null}

            <Text style={styles.section}>{s.enrolments}</Text>
            <SearchField
                value={board.query}
                onChange={board.setQuery}
                placeholder={s.enrolPlaceholder(kindWord(kind))}
            />
            {board.matches.length > 0 ? (
                <Panel flush>
                    {board.matches.map((m) => (
                        <ListRow
                            key={m.key}
                            title={m.title}
                            leading={<Avatar name={m.avatar} size="sm" />}
                            meta={s.enrol}
                            onPress={() => {
                                board.enrol(m.key);
                            }}
                        />
                    ))}
                </Panel>
            ) : null}
            <Panel flush>
                {board.enrolments.length === 0 ? (
                    <Text style={styles.empty}>{s.emptyEnrolments}</Text>
                ) : null}
                {board.enrolments.map((e, i) => (
                    <EnrolmentRow key={e.key} e={e} board={board} first={i === 0} />
                ))}
            </Panel>
        </View>
    );
}

function EnrolmentRow({ e, board, first }: { e: Enrolment; board: Board; first: boolean }) {
    return (
        <View style={[styles.row, !first && styles.divider]}>
            <Avatar name={e.name} size="sm" />
            <View style={styles.flex}>
                <Text style={styles.subject} numberOfLines={1}>
                    {e.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                    {formatParts([e.name === e.clientName ? null : e.clientName, e.attending])}
                </Text>
                {e.away !== null ? <Text style={styles.muted}>{e.away}</Text> : null}
                {e.paid ? null : (
                    <View style={styles.badges}>
                        <Badge label={strings.classes.unpaid} intent="danger" />
                    </View>
                )}
                {e.pickup !== null ? (
                    <Text style={styles.muted} numberOfLines={2}>
                        {e.pickup}
                    </Text>
                ) : null}
            </View>
            {e.upcoming ? (
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    variant="quiet"
                    onPress={() => {
                        confirm({
                            title: s.cancelEnrolmentTitle(e.name),
                            message: s.cancelEnrolmentBody,
                            confirmLabel: s.cancelEnrolment,
                            cancelLabel: s.keep,
                            destructive: true,
                        })
                            .then((ok) => {
                                if (ok) board.cancelEnrolment(e.key);
                            })
                            .catch(() => undefined);
                    }}
                >
                    {s.cancelEnrolment}
                </Button>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    gap: { gap: 12 },
    card: { gap: 6 },
    title: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    section: {
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    empty: {
        padding: 16,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        color: c.muted,
        textAlign: "center",
    },
    row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    flex: { flex: 1, minWidth: 0 },
    subject: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15, fontWeight: "600" },
    badges: { flexDirection: "row", gap: 6, marginTop: 4 },
});
