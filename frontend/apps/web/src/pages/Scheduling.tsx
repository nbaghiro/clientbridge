import {
    type StaffRow,
    WEEKDAYS,
    staffLabel,
    strings,
    useAvailabilityEditor,
    useStaff,
} from "@clientbridge/app-core";
import { useState } from "react";

const FIELD =
    "rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none transition focus:border-accent";

export function Scheduling() {
    const staff = useStaff();
    const [staffId, setStaffId] = useState<string | null>(null);
    const selected = staffId ?? staff[0]?.id ?? null;

    return (
        <div className="max-w-2xl">
            <h1 className="font-display text-2xl font-bold text-ink">{strings.scheduling.title}</h1>
            <p className="mt-1 text-sm text-muted">{strings.scheduling.subtitle}</p>

            {selected === null ? (
                <p className="mt-6 text-sm text-muted">{strings.scheduling.noStaff}</p>
            ) : (
                <>
                    {staff.length > 1 ? (
                        <label className="mt-6 flex max-w-xs flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            {strings.scheduling.teamMember}
                            <select
                                value={selected}
                                onChange={(e) => {
                                    setStaffId(e.target.value);
                                }}
                                className={FIELD}
                            >
                                {staff.map((s: StaffRow) => (
                                    <option key={s.id} value={s.id}>
                                        {staffLabel(s)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}

                    <WeeklyHours key={selected} staffId={selected} />
                </>
            )}
        </div>
    );
}

function WeeklyHours({ staffId }: { staffId: string }) {
    const editor = useAvailabilityEditor(staffId);
    const days = editor.days;

    return (
        <div className="mt-6 rounded-lg border border-line bg-surface p-6">
            {days === null ? (
                <p className="text-sm text-muted">{strings.common.loading}</p>
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
                                <label className="flex w-40 items-center gap-2 text-sm font-medium text-ink">
                                    <input
                                        type="checkbox"
                                        checked={d.open}
                                        onChange={(e) => {
                                            editor.setOpen(d.weekday, e.target.checked);
                                        }}
                                        className="accent-accent"
                                    />
                                    {label}
                                </label>
                                {d.open ? (
                                    <div className="flex items-center gap-2 text-sm text-ink-soft">
                                        <input
                                            type="time"
                                            value={d.start}
                                            onChange={(e) => {
                                                editor.setTime(d.weekday, "start", e.target.value);
                                            }}
                                            className={FIELD}
                                        />
                                        <span className="text-muted">{strings.scheduling.to}</span>
                                        <input
                                            type="time"
                                            value={d.end}
                                            onChange={(e) => {
                                                editor.setTime(d.weekday, "end", e.target.value);
                                            }}
                                            className={FIELD}
                                        />
                                    </div>
                                ) : (
                                    <span className="text-sm text-muted">
                                        {strings.scheduling.closed}
                                    </span>
                                )}
                            </div>
                        );
                    })}

                    {editor.error !== null && <p className="text-sm text-danger">{editor.error}</p>}
                    {editor.saved && <p className="text-sm text-success">{strings.common.saved}</p>}
                    <button
                        type="submit"
                        disabled={editor.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {editor.busy ? strings.common.saving : strings.scheduling.saveHours}
                    </button>
                </form>
            )}
        </div>
    );
}
