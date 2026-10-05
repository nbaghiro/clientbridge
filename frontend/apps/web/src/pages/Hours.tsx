import {
    editableStaff,
    type StaffRow,
    WEEKDAYS,
    staffLabel,
    strings,
    useHoursEditor,
    useStaff,
} from "@clientbridge/app-core";
import { useState } from "react";

import { Button, Loading, Notice, Panel, Select, TextField, Toggle } from "@clientbridge/ui";
import { useViewer } from "../lib/auth";

export function Hours() {
    const staff = editableStaff(useStaff(), useViewer());
    const [staffId, setStaffId] = useState<string | null>(null);
    const selected = staffId ?? staff[0]?.id ?? null;

    return (
        <div className="max-w-2xl">
            <h2 className="font-display text-lg font-semibold text-ink">{strings.hours.title}</h2>
            <p className="mt-1 text-sm text-muted">{strings.hours.subtitle}</p>

            {selected === null ? (
                <p className="mt-6 text-sm text-muted">{strings.hours.noStaff}</p>
            ) : (
                <>
                    {staff.length > 1 ? (
                        <div className="mt-6 max-w-xs">
                            <Select
                                label={strings.hours.teamMember}
                                value={selected}
                                options={staff.map((s: StaffRow) => ({
                                    key: s.id,
                                    label: staffLabel(s),
                                }))}
                                onChange={setStaffId}
                            />
                        </div>
                    ) : null}

                    <WeeklyHours key={selected} staffId={selected} />
                </>
            )}
        </div>
    );
}

function WeeklyHours({ staffId }: { staffId: string }) {
    const editor = useHoursEditor(staffId);
    const days = editor.days;

    return (
        <div className="mt-6">
            <Panel>
                {days === null ? (
                    <Loading inline />
                ) : (
                    <form
                        className="space-y-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            editor.submit();
                        }}
                    >
                        {days.map((d) => {
                            const label = WEEKDAYS[d.weekday]?.label ?? "";
                            return (
                                <div key={d.weekday} className="flex items-center gap-3">
                                    <div className="w-40">
                                        <Toggle
                                            label={label}
                                            value={d.open}
                                            onChange={(open) => {
                                                editor.setOpen(d.weekday, open);
                                            }}
                                        />
                                    </div>
                                    {d.open ? (
                                        <div className="flex items-center gap-2 text-sm text-ink-soft">
                                            <TextField
                                                type="time"
                                                name={strings.hours.from}
                                                width="auto"
                                                value={d.start}
                                                onChange={(v) => {
                                                    editor.setTime(d.weekday, "start", v);
                                                }}
                                            />
                                            <span className="text-muted">{strings.hours.to}</span>
                                            <TextField
                                                type="time"
                                                name={strings.hours.to}
                                                width="auto"
                                                value={d.end}
                                                onChange={(v) => {
                                                    editor.setTime(d.weekday, "end", v);
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-sm text-muted">
                                            {strings.hours.closed}
                                        </span>
                                    )}
                                </div>
                            );
                        })}

                        {editor.error !== null && <Notice tone="danger">{editor.error}</Notice>}
                        {editor.saved && <Notice tone="success">{strings.common.saved}</Notice>}
                        <Button submit busy={editor.busy}>
                            {editor.busy ? strings.common.saving : strings.hours.saveHours}
                        </Button>
                    </form>
                )}
            </Panel>
        </div>
    );
}
