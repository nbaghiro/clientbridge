import {
    type CalendarEntry,
    type Fact,
    type PublicBookingFlow,
    addsLabel,
    durationLabel,
    icsFor,
    isPlace,
    strings,
    formatParts,
    formatMoney,
    SUBJECT_ICON,
} from "@clientbridge/app-core/public";
import {
    Button,
    CardForm,
    Choice,
    DayRail,
    OptionCard,
    Empty,
    FactList,
    Icon,
    IconButton,
    ItemImage,
    Notice,
    Skeleton,
    TextField,
    SlotChips,
} from "@clientbridge/ui";

const s = strings.publicBooking;

export function addToCalendar(entries: readonly CalendarEntry[] | null): void {
    if (entries === null || entries.length === 0) return;
    const url = URL.createObjectURL(new Blob([icsFor(entries)], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "visit.ics";
    a.click();
    URL.revokeObjectURL(url);
}

export function ServicePicker({ flow }: { flow: PublicBookingFlow }) {
    return (
        <div className="space-y-5">
            {flow.categories.map((c) => (
                <section key={c.category}>
                    {c.category !== "" ? (
                        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                            {c.category}
                        </h3>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                        {c.services.map((x) => (
                            <OptionCard
                                key={x.id}
                                title={x.name}
                                subtitle={formatParts([
                                    x.duration_min !== null ? durationLabel(x.duration_min) : null,
                                    x.deposit_required
                                        ? s.deposit(formatMoney(x.deposit_amount_cents, x.currency))
                                        : null,
                                ])}
                                leading={<ItemImage src={x.image_url} name={x.name} size={48} />}
                                trailing={
                                    <span className="font-mono text-sm font-semibold text-ink">
                                        {formatMoney(x.price_cents, x.currency)}
                                    </span>
                                }
                                selected={flow.service?.id === x.id}
                                onPress={() => {
                                    flow.setService(x.id);
                                }}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

export function WhenPicker({ flow }: { flow: PublicBookingFlow }) {
    return (
        <div className="space-y-6">
            <div>
                <p className="mb-2 text-sm font-medium text-ink-soft">{s.with}</p>
                <Choice
                    layout="chips"
                    label={s.with}
                    value={flow.staffId}
                    onChange={flow.setStaffId}
                    options={flow.staffOptions.map((o) => ({
                        key: o.id,
                        label: o.name,
                        media: o.media,
                    }))}
                />
            </div>
            {flow.programs !== null ? (
                <ProgramDates flow={flow} programs={flow.programs} />
            ) : (
                <div className="space-y-4">
                    <p className="text-sm font-medium text-ink-soft first-letter:uppercase">
                        {flow.dateLabel}
                    </p>
                    {flow.zoneNote !== null ? (
                        <p className="text-xs text-muted">{flow.zoneNote}</p>
                    ) : null}
                    <DayRail
                        label={s.date}
                        days={flow.strip}
                        value={flow.date}
                        onChange={flow.setDate}
                        {...(flow.canPrevWeek ? { onPrev: flow.prevWeek } : {})}
                        {...(flow.canNextWeek ? { onNext: flow.nextWeek } : {})}
                        prevLabel={s.prevWeek}
                        nextLabel={s.nextWeek}
                    />
                    <div className="min-h-[148px]">
                        {flow.slotsError ? (
                            <Empty
                                intent="danger"
                                icon="cloudOff"
                                message={s.slotsError}
                                actions={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        icon="refresh"
                                        onPress={flow.retrySlots}
                                    >
                                        {s.retry}
                                    </Button>
                                }
                            />
                        ) : flow.slots === null ? (
                            <Skeleton variant="line" count={3} label={s.loadingTimes} />
                        ) : flow.slots.length === 0 ? (
                            <Empty
                                icon={flow.closure !== null ? "lock" : "calendar"}
                                message={
                                    flow.closure !== null
                                        ? s.closedDay(flow.closure)
                                        : s.noTimes(flow.dateLabel)
                                }
                                body={flow.firstOpen === null ? s.noTimesWeek : undefined}
                                actions={
                                    flow.firstOpen !== null ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onPress={() => {
                                                if (flow.firstOpen)
                                                    flow.setDate(flow.firstOpen.key);
                                            }}
                                        >
                                            {s.nextOpen(flow.firstOpen.label)}
                                        </Button>
                                    ) : flow.canNextWeek ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            icon="chevronRight"
                                            onPress={flow.nextWeek}
                                        >
                                            {s.nextWeek}
                                        </Button>
                                    ) : undefined
                                }
                            />
                        ) : (
                            <SlotChips
                                label={s.openTimes}
                                groups={flow.slotGroups}
                                value={flow.startsAt || null}
                                onChange={flow.pickSlot}
                                columns={4}
                            />
                        )}
                    </div>
                    {flow.waitlistNotice !== null ? (
                        <Notice tone="info">{flow.waitlistNotice}</Notice>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function ProgramDates({
    flow,
    programs,
}: {
    flow: PublicBookingFlow;
    programs: readonly { key: string; label: string; hint: string }[];
}) {
    return (
        <div className="space-y-4">
            <p className="text-sm font-medium text-ink-soft">{s.programPick}</p>
            {flow.zoneNote !== null ? <p className="text-xs text-muted">{flow.zoneNote}</p> : null}
            {flow.slotsError ? (
                <Empty
                    intent="danger"
                    icon="cloudOff"
                    message={s.slotsError}
                    actions={
                        <Button
                            size="sm"
                            variant="outline"
                            icon="refresh"
                            onPress={flow.retrySlots}
                        >
                            {s.retry}
                        </Button>
                    }
                />
            ) : flow.slots === null ? (
                <Skeleton variant="line" count={3} label={s.loadingTimes} />
            ) : programs.length === 0 ? (
                <Empty icon="calendar" message={s.programNone} />
            ) : (
                <Choice
                    layout="cards"
                    label={s.programPick}
                    options={programs}
                    value={flow.startsAt || null}
                    onChange={flow.pickSlot}
                />
            )}
            {flow.programNote !== null ? <Notice tone="info">{flow.programNote}</Notice> : null}
        </div>
    );
}

function visitFacts(flow: PublicBookingFlow): Fact[] {
    const facts: Fact[] = [];
    if (flow.service !== null)
        facts.push({
            key: "service",
            icon: flow.kind === null ? "tag" : SUBJECT_ICON[flow.kind],
            title: flow.service.name,
            ...(flow.service.duration_min !== null
                ? { detail: durationLabel(flow.service.duration_min) }
                : {}),
        });
    if (flow.when !== null)
        facts.push({
            key: "time",
            icon: "calendar",
            title: flow.whenTitle ?? "",
            ...(flow.slotStaff?.name ? { detail: s.withName(flow.slotStaff.name) } : {}),
        });
    return facts;
}

export function SuggestedExtras({ flow }: { flow: PublicBookingFlow }) {
    if (flow.offered.length === 0) return null;
    return (
        <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">{s.oftenAdded}</h2>
                <p className="text-xs text-muted">{s.addonsPaidLater}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
                {flow.offered.map((a) => {
                    const on = (flow.addons[a.id] ?? 0) > 0;
                    return (
                        <li
                            key={a.id}
                            className={`flex items-center gap-3 rounded-lg border bg-surface p-3 ${on ? "border-accent" : "border-line"} ${a.in_stock ? "" : "opacity-60"}`}
                        >
                            <ItemImage src={a.image_url} name={a.name} size={44} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                                <p className="text-sm tabular-nums text-ink-soft">
                                    {formatParts([
                                        formatMoney(a.price_cents, a.currency),
                                        addsLabel(a),
                                    ])}
                                </p>
                            </div>
                            {a.in_stock ? (
                                <IconButton
                                    icon={on ? "check" : "plus"}
                                    label={s.addNamed(a.name)}
                                    variant="outline"
                                    pressed={on}
                                    onPress={() => {
                                        flow.toggleAddon(a.id);
                                    }}
                                />
                            ) : (
                                <span className="text-xs font-medium text-muted">{s.soldOut}</span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export function DetailsForm({ flow }: { flow: PublicBookingFlow }) {
    const f = flow.fields;
    return (
        <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                    label={s.name}
                    value={f.name}
                    onChange={f.setName}
                    placeholder={s.namePlaceholder}
                    autoComplete="name"
                    error={flow.errors.name}
                />
                {flow.kind !== null ? (
                    <TextField
                        label={s.subject(flow.kind)}
                        value={f.subjectName}
                        onChange={f.setSubjectName}
                        placeholder={s.subjectPlaceholder(flow.kind)}
                        error={flow.errors.subject}
                    />
                ) : null}
                {isPlace(flow.kind) && flow.subjectId === null ? (
                    <TextField
                        label={s.address}
                        value={f.subjectAddress}
                        onChange={f.setSubjectAddress}
                        placeholder={s.addressPlaceholder}
                        autoComplete="street-address"
                        error={flow.errors.address}
                    />
                ) : null}
                <TextField
                    label={s.phone}
                    type="tel"
                    value={f.phone}
                    onChange={f.setPhone}
                    placeholder={s.phonePlaceholder}
                    autoComplete="tel"
                    error={flow.errors.contact}
                />
                <TextField
                    label={s.email}
                    type="email"
                    value={f.email}
                    onChange={f.setEmail}
                    placeholder={s.emailPlaceholder}
                    autoComplete="email"
                    optional
                    error={flow.errors.email}
                />
            </div>
            <TextField
                label={s.note}
                value={f.note}
                onChange={f.setNote}
                placeholder={flow.notePlaceholder}
                multiline
                rows={2}
                optional
            />
            <p className="text-xs text-muted">{s.reachHint}</p>
        </div>
    );
}

export function PayStep({ flow }: { flow: PublicBookingFlow }) {
    const r = flow.result;
    const policy = flow.page?.policy ?? null;
    const secret = r?.deposit_client_secret ?? null;
    if (r === null || secret === null) return null;
    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-display text-xl font-bold text-ink">{s.payTitle}</h2>
                <p className="mt-1 text-sm text-muted">{s.payBody(flow.totals.deposit)}</p>
            </div>
            {r.stripe_account_id !== null ? (
                <CardForm
                    clientSecret={secret}
                    stripeAccount={r.stripe_account_id}
                    submitLabel={s.pay(flow.totals.deposit)}
                    busyLabel={s.paying}
                    onDone={flow.paid}
                />
            ) : (
                <p className="text-sm text-muted">{s.payLater}</p>
            )}
            <p className="flex items-start gap-2 text-xs text-muted">
                <Icon name="shield" size={14} />
                <span>
                    {policy !== null
                        ? strings.common.twoSentences(
                              s.payPolicy(
                                  policy.cancel_cutoff_hours,
                                  policy.reschedule_cutoff_hours,
                                  true,
                              ),
                              s.secure,
                          )
                        : s.secure}
                </span>
            </p>
        </div>
    );
}

export function DoneCard({
    flow,
    onManage,
}: {
    flow: PublicBookingFlow;
    onManage: (() => void) | null;
}) {
    const subject = flow.kind === null ? "" : flow.fields.subjectName.trim();
    const when = flow.when ?? "";
    const pending = flow.result?.status === "pending" || flow.waitlistBody !== null;
    return (
        <div className="text-center">
            <Icon
                name={pending ? "clock" : "check"}
                size={32}
                className="mx-auto block text-ink-soft"
            />
            <h1 className="mt-4 font-display text-2xl font-bold text-ink">
                {flow.waitlistBody !== null
                    ? s.waitlistTitle
                    : pending
                      ? s.pendingTitle
                      : s.doneTitle}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted first-letter:uppercase">
                {flow.waitlistBody ??
                    (pending
                        ? s.pendingBody(when)
                        : subject
                          ? s.doneBody(subject, when)
                          : s.doneNoSubject(when))}
            </p>
            <div className="mx-auto mt-5 max-w-sm rounded-lg border border-line bg-bg p-4 text-left">
                <FactList facts={visitFacts(flow)} label={s.summary} />
                {flow.totals.depositCents > 0 && flow.result?.stripe_account_id != null ? (
                    <p className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3 text-sm text-ok-fg">
                        <Icon name="check" size={14} />
                        {s.depositPaid(flow.totals.deposit)}
                    </p>
                ) : null}
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
                {flow.waitlistBody === null ? (
                    <Button
                        variant="outline"
                        icon="calendar"
                        onPress={() => {
                            addToCalendar(flow.calendar);
                        }}
                    >
                        {s.addToCalendar}
                    </Button>
                ) : null}
                {onManage !== null ? (
                    <Button variant="outline" icon="edit" onPress={onManage}>
                        {s.manage}
                    </Button>
                ) : null}
                <Button variant="quiet" onPress={flow.restart}>
                    {s.bookAnother}
                </Button>
            </div>
        </div>
    );
}
