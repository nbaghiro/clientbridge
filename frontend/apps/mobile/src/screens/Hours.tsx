import {
    editableStaff,
    type StaffRow,
    WEEKDAYS,
    staffLabel,
    strings,
    useHoursEditor,
    useStaff,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Choice, Empty, Loading, Notice, Panel, TextField, Toggle } from "@clientbridge/ui";

import { useViewer } from "../lib/auth";

const c = theme.colors;

export function Hours() {
    const staff = editableStaff(useStaff(), useViewer());
    const [staffId, setStaffId] = useState<string | null>(null);
    const selected = staffId ?? staff[0]?.id ?? null;

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{strings.hours.title}</Text>
            <Text style={styles.note}>{strings.hours.subtitle}</Text>

            {selected === null ? (
                <Empty message={strings.hours.noStaff} />
            ) : (
                <>
                    {staff.length > 1 ? (
                        <View style={styles.chipWrap}>
                            <Choice
                                label={strings.hours.teamMember}
                                options={staff.map((s: StaffRow) => ({
                                    key: s.id,
                                    label: staffLabel(s),
                                }))}
                                value={selected}
                                onChange={setStaffId}
                            />
                        </View>
                    ) : null}

                    <WeeklyHours key={selected} staffId={selected} />
                </>
            )}
        </View>
    );
}

function WeeklyHours({ staffId }: { staffId: string }) {
    const editor = useHoursEditor(staffId);
    const days = editor.days;

    if (days === null) {
        return <Loading />;
    }

    return (
        <Panel>
            {days.map((d, i) => {
                const label = WEEKDAYS[d.weekday]?.label ?? "";
                return (
                    <View key={d.weekday} style={[styles.row, i > 0 ? styles.rowBorder : null]}>
                        <Toggle
                            label={label}
                            value={d.open}
                            onChange={(v) => {
                                editor.setOpen(d.weekday, v);
                            }}
                        />
                        {d.open ? (
                            <View style={styles.times}>
                                <TextField
                                    type="time"
                                    width="auto"
                                    name={strings.hours.from}
                                    value={d.start}
                                    onChange={(v) => {
                                        editor.setTime(d.weekday, "start", v);
                                    }}
                                    placeholder={strings.hours.startHint}
                                />
                                <Text style={styles.to}>{strings.hours.to}</Text>
                                <TextField
                                    type="time"
                                    width="auto"
                                    name={strings.hours.to}
                                    value={d.end}
                                    onChange={(v) => {
                                        editor.setTime(d.weekday, "end", v);
                                    }}
                                    placeholder={strings.hours.endHint}
                                />
                            </View>
                        ) : (
                            <Text style={styles.closed}>{strings.hours.closed}</Text>
                        )}
                    </View>
                );
            })}

            {editor.error !== null ? <Notice tone="danger">{editor.error}</Notice> : null}
            {editor.saved ? <Notice tone="success">{strings.common.saved}</Notice> : null}

            <View style={styles.submitGap}>
                <Button size="lg" full onPress={editor.submit} busy={editor.busy}>
                    {strings.hours.saveHours}
                </Button>
            </View>
        </Panel>
    );
}

const styles = StyleSheet.create({
    section: { marginTop: 28 },
    sectionTitle: { color: c.ink, fontSize: 17, fontWeight: "700", marginBottom: 8 },
    note: { color: c.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    chipWrap: { marginBottom: 14 },
    row: { paddingVertical: 12 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    times: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
    to: { color: c.muted, fontSize: 13 },
    closed: { color: c.muted, fontSize: 13, marginTop: 4 },
    submitGap: { marginTop: 18 },
});
