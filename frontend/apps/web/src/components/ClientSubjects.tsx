import {
    type SubjectCard,
    type SubjectForm,
    type SubjectKind,
    type SubjectRow,
    SUBJECT_ICON,
    formatDate,
    kindWord,
    relativeDay,
    strings,
    useSubjectCards,
    useSubjectForm,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    confirm,
    Empty,
    Field,
    Icon,
    LoadFailed,
    Modal,
    Notice,
    Skeleton,
    TextField,
    DateField,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";

const s = strings.subjects;

/** Renders a subject's fields from its kind's schema, so other kinds need no new form. */
function SubjectFields({ form }: { form: SubjectForm }) {
    const zone = useBusinessZone();
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
                <TextField
                    label={s.nameLabel}
                    required
                    value={form.name}
                    onChange={form.setName}
                    error={form.errors.name}
                    autoFocus={form.mode === "add"}
                />
            </div>
            {form.fields.map((f) => {
                const value = form.values[f.key] ?? "";
                const span = f.half === true ? "" : "sm:col-span-2";
                if (f.type === "choice")
                    return (
                        <div key={f.key} className={span}>
                            <Field label={f.label}>
                                <Choice
                                    label={f.label}
                                    options={f.options ?? []}
                                    value={value === "" ? null : value}
                                    onChange={(v) => {
                                        form.setValue(f.key, v === value ? "" : v);
                                    }}
                                />
                            </Field>
                        </div>
                    );
                if (f.type === "date")
                    return (
                        <div key={f.key} className={span}>
                            <DateField
                                zone={zone}
                                label={f.label}
                                optional
                                value={value}
                                onChange={(v) => {
                                    form.setValue(f.key, v);
                                }}
                                error={form.errors[f.key]}
                            />
                        </div>
                    );
                return (
                    <div key={f.key} className={span}>
                        <TextField
                            label={
                                f.unit === undefined
                                    ? f.label
                                    : strings.common.withDetail(f.label, f.unit)
                            }
                            optional
                            type={f.type === "number" ? "number" : "text"}
                            multiline={f.type === "longtext"}
                            rows={2}
                            value={value}
                            placeholder={f.placeholder}
                            onChange={(v) => {
                                form.setValue(f.key, v);
                            }}
                            error={form.errors[f.key]}
                        />
                    </div>
                );
            })}
        </div>
    );
}

/** Add or edit one subject in a dialog, from the subject cards or the client record. */
export function SubjectDialog({
    clientId,
    subject,
    onClose,
}: {
    clientId: string;
    subject: SubjectRow | null;
    onClose: () => void;
}) {
    const form = useSubjectForm(api, clientId, subject, onClose);
    const word = kindWord(form.kind);
    const askRemove = (): void => {
        confirm({
            title: s.removeTitle(form.name),
            message: s.removeBody(word),
            confirmLabel: s.removeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) form.remove();
            })
            .catch(() => undefined);
    };
    return (
        <Modal variant="drawer" onClose={onClose} size="lg">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
            >
                <h2 className="font-display text-lg font-bold text-ink">
                    {form.mode === "add" ? s.add(word) : s.editNamed(form.name)}
                </h2>
                <div className="-mx-6 mt-4 max-h-[calc(100vh-13rem)] overflow-y-auto px-6 pb-1">
                    <SubjectFields form={form} />
                </div>
                {form.error !== null ? (
                    <div className="mt-3">
                        <Notice tone="danger" banner>
                            {form.error}
                        </Notice>
                    </div>
                ) : null}
                <div className="mt-5 flex items-center gap-2 border-t border-line-soft pt-4">
                    {form.mode === "edit" ? (
                        <Button variant="quiet" onPress={askRemove}>
                            {s.remove(word)}
                        </Button>
                    ) : null}
                    <span className="flex-1" />
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy ? s.saving : s.save(word)}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function SubjectCardView({ card, onEdit }: { card: SubjectCard; onEdit: () => void }) {
    const zone = useBusinessZone();
    const alerts = card.alerts.filter((a) => a.key !== "temp");
    return (
        <article className="flex flex-col rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-start gap-3 p-4">
                <Avatar name={card.subject.name} size="lg" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate font-display text-base font-bold text-ink">
                            {card.subject.name}
                        </h3>
                        {card.temperament !== null ? (
                            <Badge
                                label={card.temperament.label}
                                intent={card.temperament.nervous ? "warning" : "neutral"}
                            />
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{card.line}</p>
                </div>
                <Button
                    size="sm"
                    variant="quiet"
                    onPress={onEdit}
                    label={s.editNamed(card.subject.name)}
                    icon={<Icon name="edit" size={15} />}
                >
                    {s.edit}
                </Button>
            </div>
            {alerts.length > 0 ? (
                <ul className="space-y-1.5 px-4 pb-3">
                    {alerts.map((a) => (
                        <li
                            key={a.key}
                            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                                a.intent === "danger"
                                    ? "bg-danger-bg text-danger-fg"
                                    : "bg-warn-bg text-warn-fg"
                            }`}
                        >
                            <Icon name="alert" size={14} />
                            {a.label}
                        </li>
                    ))}
                </ul>
            ) : null}
            <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-line-soft px-4 py-3 text-xs">
                <div>
                    <dt className="text-muted">{s.visits}</dt>
                    <dd className="mt-0.5 font-semibold text-ink">{card.visits}</dd>
                </div>
                <div>
                    <dt className="text-muted">{s.lastVisit}</dt>
                    <dd className="mt-0.5 font-semibold text-ink">
                        {card.lastVisit === null
                            ? strings.clients.dash
                            : formatDate(card.lastVisit, zone)}
                    </dd>
                </div>
                <div>
                    <dt className="text-muted">{s.nextVisit}</dt>
                    <dd className="mt-0.5 font-semibold text-ink">
                        {card.next === null ? s.nothingBooked : relativeDay(card.next, zone)}
                    </dd>
                </div>
            </dl>
        </article>
    );
}

/** A client's subjects as cards, each edited in a dialog. */
export function ClientSubjects({ clientId, kind }: { clientId: string; kind: SubjectKind }) {
    const { load, cards } = useSubjectCards(clientId);
    const [editing, setEditing] = useState<{ subject: SubjectRow | null } | null>(null);
    const add = (): void => {
        setEditing({ subject: null });
    };

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-ink">{s.many(kind)}</h2>
                <Button icon={<Icon name="plus" size={16} />} onPress={add}>
                    {s.add(kind)}
                </Button>
            </div>
            {load.state === "loading" ? (
                <Skeleton variant="row" count={2} label={s.loading(kind)} />
            ) : null}
            {load.state === "error" ? (
                <LoadFailed
                    message={s.loadError(kind)}
                    onRetry={load.retry}
                    retrying={load.retrying}
                />
            ) : null}
            {load.hasData && cards.length === 0 ? (
                <Empty
                    variant="card"
                    icon={SUBJECT_ICON[kind]}
                    message={s.noneTitle(kind)}
                    body={s.noneBody(kind)}
                    actions={<Button onPress={add}>{s.add(kind)}</Button>}
                />
            ) : null}
            {cards.length > 0 ? (
                <div className="grid items-start gap-4 md:grid-cols-2">
                    {cards.map((card) => (
                        <SubjectCardView
                            key={card.subject.id}
                            card={card}
                            onEdit={() => {
                                setEditing({ subject: card.subject });
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {editing !== null ? (
                <SubjectDialog
                    key={editing.subject?.id ?? "new"}
                    clientId={clientId}
                    subject={editing.subject}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            ) : null}
        </section>
    );
}
