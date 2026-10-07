import {
    type ComposerSlot,
    type ScheduleBoard,
    type ScheduleEvent,
    formatMoney,
    formatPhone,
    strings,
    useBookingComposer,
    useReschedule,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Choice,
    DateStrip,
    Empty,
    IconButton,
    ListRow,
    Modal,
    Notice,
    SearchField,
    Select,
    Stepper,
    TextField,
    TimeSlotPicker,
    Toggle,
} from "@clientbridge/ui";
import type { SubmitEvent } from "react";

import { api } from "../lib/api";

const s = strings.bookings;

/** The new-booking form, prefilled from the open time that was clicked. Sits in a rail or a modal. */
export function BookingComposer({
    slot,
    board,
    onDone,
    onCancel,
}: {
    slot: ComposerSlot;
    board: ScheduleBoard;
    onDone: () => void;
    onCancel: () => void;
}) {
    const form = useBookingComposer(
        api,
        slot,
        { avail: board.avail, events: board.weekEvents, staff: board.staff },
        onDone,
    );
    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };
    return (
        <form
            onSubmit={submit}
            className="flex h-full min-h-0 flex-col"
            aria-label={s.composerTitle}
        >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="font-display text-lg font-bold text-ink">{s.composerTitle}</h2>
                <IconButton size="sm" icon="x" label={s.close} onPress={onCancel} />
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="space-y-2">
                    <p className="text-sm font-medium text-ink-soft">{s.composerClient}</p>
                    {form.client ? (
                        <div className="flex items-center gap-3 rounded-md border border-accent bg-accent-weak/50 px-3 py-2">
                            <Avatar name={form.client.name} size="sm" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-ink">
                                    {form.client.name}
                                </div>
                                <div className="truncate text-xs text-muted">
                                    {formatPhone(form.client.phone)}
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="link"
                                onPress={() => {
                                    form.pickClient(null);
                                }}
                            >
                                {s.composerChange}
                            </Button>
                        </div>
                    ) : (
                        <>
                            <SearchField
                                value={form.query}
                                onChange={form.setQuery}
                                placeholder={s.composerClientSearch}
                                autoFocus
                            />
                            {form.matches.length === 0 ? (
                                <p className="text-sm text-muted">{s.composerNoClients}</p>
                            ) : (
                                <div className="divide-y divide-line-soft overflow-hidden rounded-md border border-line">
                                    {form.matches.map((m) => (
                                        <ListRow
                                            key={m.client.id}
                                            density="compact"
                                            leading={<Avatar name={m.client.name} size="sm" />}
                                            title={m.client.name}
                                            detail={m.pets.join(", ")}
                                            onPress={() => {
                                                form.pickClient(m.client.id);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    {form.pets.length > 1 ? (
                        <Choice
                            label={s.composerPet}
                            options={form.pets.map((p) => ({ key: p.id, label: p.name }))}
                            value={form.petId}
                            onChange={form.setPetId}
                        />
                    ) : null}
                </section>

                <Select
                    label={s.composerService}
                    value={form.item?.id ?? ""}
                    options={[
                        { key: "", label: s.composerService },
                        ...form.services.map((i) => ({
                            key: i.id,
                            label: `${i.name} · ${String(i.duration_min ?? 60)} min · ${formatMoney(i.price_cents ?? 0)}`,
                        })),
                    ]}
                    onChange={form.setItemId}
                />

                <div className="space-y-2">
                    <p className="text-sm font-medium text-ink-soft">{s.composerWith}</p>
                    <Choice
                        label={s.composerWith}
                        options={form.staffOptions.map((o) => ({
                            key: o.id,
                            label: o.name.split(" ")[0] ?? o.name,
                            hint: form.item === null || o.free ? undefined : s.busy,
                        }))}
                        value={form.staffId}
                        onChange={form.setStaffId}
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <TextField
                        label={s.composerDate}
                        type="date"
                        value={form.day}
                        onChange={form.setDay}
                    />
                    <Select
                        label={s.composerTime}
                        value={form.time}
                        options={form.timeOptions}
                        onChange={form.setTime}
                    />
                </div>
                {form.item ? <p className="-mt-3 text-xs text-muted">{form.endsLabel}</p> : null}
                {form.problem !== null ? (
                    <Notice tone="danger" banner>
                        {form.problem}
                    </Notice>
                ) : null}

                <div className="space-y-3 rounded-md border border-line px-3 py-2">
                    <Toggle
                        label={s.composerRepeat}
                        value={form.repeat}
                        onChange={form.setRepeat}
                    />
                    {form.repeat ? (
                        <div className="grid grid-cols-2 gap-3 pb-2">
                            <Stepper
                                label={`${s.composerRepeatEvery} (${s.everyWeeks(form.every)})`}
                                value={form.every}
                                min={1}
                                max={12}
                                onChange={form.setEvery}
                            />
                            <Stepper
                                label={s.composerRepeatTimes}
                                value={form.count}
                                min={2}
                                max={52}
                                onChange={form.setCount}
                            />
                        </div>
                    ) : null}
                </div>

                {form.repeat ? null : (
                    <TextField
                        label={s.composerNote}
                        optional
                        multiline
                        rows={2}
                        value={form.note}
                        onChange={form.setNote}
                        placeholder={s.composerNotePlaceholder}
                    />
                )}
                <Toggle label={s.composerConfirm} value={form.notify} onChange={form.setNotify} />
                {form.depositLine !== null ? (
                    <Notice tone="info" banner>
                        {form.depositLine}
                    </Notice>
                ) : null}
                {form.notice !== null ? <Notice tone="success">{form.notice}</Notice> : null}
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
                <Button variant="quiet" onPress={onCancel}>
                    {s.composerCancel}
                </Button>
                {form.notice !== null ? (
                    <Button onPress={onDone}>{s.close}</Button>
                ) : (
                    <Button submit busy={form.busy} disabled={!form.canSubmit}>
                        {form.busy
                            ? s.composerBooking
                            : form.repeat
                              ? s.composerBookSeries(form.count)
                              : s.composerBook}
                    </Button>
                )}
            </div>
        </form>
    );
}

/** Pick another person, day and open time for a visit; the same check as a drag decides what's open. */
export function RescheduleDialog({
    event,
    onClose,
}: {
    event: ScheduleEvent;
    onClose: () => void;
}) {
    const r = useReschedule(api, event, onClose);
    return (
        <Modal size="lg" onClose={onClose}>
            <div className="space-y-5">
                <div>
                    <h2 className="font-display text-lg font-bold text-ink">{s.rescheduleTitle}</h2>
                    <p className="mt-0.5 text-sm text-muted">{`${event.headline} · ${event.serviceName} · ${event.timeLabel}`}</p>
                </div>
                <div className="space-y-2">
                    <p className="text-sm font-medium text-ink-soft">{s.rescheduleWith}</p>
                    <Choice
                        label={s.rescheduleWith}
                        layout="segmented"
                        options={r.staffOptions}
                        value={r.staffId}
                        onChange={r.setStaffId}
                    />
                </div>
                <DateStrip
                    label={s.rescheduleDay}
                    days={r.days}
                    value={r.day}
                    onChange={r.setDay}
                    onPrev={() => {
                        r.shiftWeek(-1);
                    }}
                    onNext={() => {
                        r.shiftWeek(1);
                    }}
                    prevLabel={s.prev}
                    nextLabel={s.next}
                />
                <div className="max-h-[300px] overflow-y-auto pr-1">
                    {r.open === 0 ? (
                        <Empty message={s.noTimes} />
                    ) : (
                        <TimeSlotPicker
                            label={s.rescheduleTimes}
                            groups={r.groups}
                            value={r.value}
                            onChange={r.setValue}
                            columns={5}
                        />
                    )}
                </div>
                {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                    <p className="text-xs text-muted">{s.rescheduleNotice}</p>
                    <div className="flex gap-2">
                        <Button variant="quiet" onPress={onClose}>
                            {s.composerCancel}
                        </Button>
                        <Button busy={r.busy} disabled={r.value === null} onPress={r.submit}>
                            {r.busy
                                ? s.rescheduling
                                : r.target !== null
                                  ? s.rescheduleTo(r.target)
                                  : s.reschedule}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
