import { strings, useBusinessZone, useProgramForm } from "@clientbridge/app-core";
import { Button, Choice, DateField, Modal, Notice, Select } from "@clientbridge/ui";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const s = strings.programs;

/** Schedule every day of a program from the Classes page; finishing names it on the board. */
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
        <Modal variant="drawer" size="lg" onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{s.formTitle}</h2>
                    <p className="text-sm text-muted">{s.formSubtitle}</p>
                </div>
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
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-soft">{s.weekdays}</p>
                    <Choice
                        layout="chips"
                        label={s.weekdays}
                        options={f.weekdayOptions}
                        value={f.weekdays}
                        onChange={f.toggleWeekday}
                    />
                </div>
                {f.summary !== null ? (
                    <div className="rounded-md border border-line bg-bg px-4 py-3">
                        <p className="text-sm font-medium text-ink">{f.summary}</p>
                        <p className="mt-1 text-xs text-muted">{f.preview}</p>
                        {f.rooms !== null ? (
                            <p className="mt-1 text-xs text-muted">{f.rooms}</p>
                        ) : null}
                    </div>
                ) : null}
                {f.blocker !== null ? <p className="text-sm text-muted">{f.blocker}</p> : null}
                {f.error !== null ? <Notice tone="danger">{f.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {s.close}
                    </Button>
                    <Button busy={f.busy} disabled={!f.canSubmit} onPress={f.submit}>
                        {s.create}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
