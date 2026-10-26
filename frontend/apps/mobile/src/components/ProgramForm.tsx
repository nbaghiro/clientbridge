import { strings, useBusinessZone, useProgramForm } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Choice, DateField, Modal, Notice, Select, SheetHeader } from "@clientbridge/ui";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const s = strings.programs;

/** Schedule every day of a program from the Classes screen; finishing names it on the board. */
export function ProgramForm({
    onClose,
    onDone,
}: {
    onClose: () => void;
    onDone: (name: string) => void;
}) {
    const zone = useBusinessZone();
    const f = useProgramForm(api, useViewer(), onDone);
    return (
        <Modal size="xl" onClose={onClose}>
            <View style={styles.sheet}>
                <SheetHeader title={s.formTitle} />
                <Text style={styles.muted}>{s.formSubtitle}</Text>
                {f.itemOptions.length === 0 ? <Notice tone="info">{s.noPrograms}</Notice> : null}
                <Select
                    label={s.program}
                    hint={s.programHint}
                    value={f.itemId}
                    placeholder={s.pickProgram}
                    options={f.itemOptions}
                    onChange={f.setItemId}
                />
                <Select
                    label={s.instructor}
                    value={f.staffId}
                    options={f.staffOptions}
                    onChange={f.setStaffId}
                />
                <DateField
                    zone={zone}
                    label={s.firstDay}
                    value={f.firstDay}
                    onChange={f.setFirstDay}
                />
                <Select
                    label={s.time}
                    value={f.time}
                    options={f.timeOptions}
                    onChange={f.setTime}
                />
                <Text style={styles.label}>{s.weekdays}</Text>
                <Choice
                    layout="chips"
                    label={s.weekdays}
                    options={f.weekdayOptions}
                    value={f.weekdays}
                    onChange={f.toggleWeekday}
                />
                {f.summary !== null ? (
                    <View style={styles.preview}>
                        <Text style={styles.summary}>{f.summary}</Text>
                        <Text style={styles.muted}>{f.preview}</Text>
                        {f.rooms !== null ? <Text style={styles.muted}>{f.rooms}</Text> : null}
                    </View>
                ) : null}
                {f.blocker !== null ? <Text style={styles.muted}>{f.blocker}</Text> : null}
                {f.error !== null ? <Notice tone="danger">{f.error}</Notice> : null}
                <Button full busy={f.busy} disabled={!f.canSubmit} onPress={f.submit}>
                    {s.create}
                </Button>
                <Button full variant="quiet" onPress={onClose}>
                    {s.close}
                </Button>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheet: { gap: 12 },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    label: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "500" },
    summary: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    preview: {
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        padding: 12,
        gap: 4,
    },
});
