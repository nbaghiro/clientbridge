import {
    type FormAnswer,
    type PublicBrand,
    type PublicFormField,
    createPublicFormClient,
    isFileField,
    optionPair,
    strings,
    usePublicFormFill,
} from "@clientbridge/app-core/public";
import type { SubmitEvent } from "react";
import { useParams } from "react-router-dom";

import { Button, Choice, Field, Notice, Select, TextField, Toggle } from "@clientbridge/ui";
import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const forms = createPublicFormClient(config.apiUrl);

export function PublicForm() {
    const { token = "" } = useParams<{ token: string }>();
    const fill = usePublicFormFill(forms, token);
    const form = fill.form;
    const answers = fill.answers;
    useEmbedSuccess(fill.status === "done", "form");

    if (fill.status === "loading")
        return (
            <PublicFrame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</PublicFrame>
        );

    if (fill.status === "not-found")
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicForm.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicForm.notFoundBody}</p>
            </PublicFrame>
        );

    if (fill.status === "error" || form === null)
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </PublicFrame>
        );

    if (fill.status === "done")
        return <DoneState businessName={form.business_name} brand={form.brand} />;

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        fill.submit();
    };

    return (
        <PublicFrame size="xl" brand={form.brand}>
            <p className="text-sm text-muted">{form.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{form.form_name}</h1>

            <form onSubmit={submit} className="mt-6 space-y-5">
                {form.fields.map((f) => (
                    <FieldView
                        key={f.id}
                        field={f}
                        value={answers[f.name]}
                        onChange={(v) => {
                            fill.setAnswer(f.name, v);
                        }}
                        onUpload={(file) => {
                            fill.uploadFor(f.name, file);
                        }}
                    />
                ))}
                {fill.error !== null ? <Notice tone="danger">{fill.error}</Notice> : null}
                <Button submit size="lg" full busy={fill.busy}>
                    {fill.busy ? strings.publicForm.submitting : strings.publicForm.submit}
                </Button>
            </form>
        </PublicFrame>
    );
}

function FieldView({
    field: f,
    value,
    onChange,
    onUpload,
}: {
    field: PublicFormField;
    value: FormAnswer | undefined;
    onChange: (v: FormAnswer) => void;
    onUpload: (file: File) => void;
}) {
    const help = f.help ?? undefined;

    if (isFileField(f.input)) {
        const uploaded = typeof value === "string" && value.length > 0;
        const accept = f.input === "image" || f.input === "signature" ? "image/*" : "*/*";
        return (
            <Field label={f.label} hint={help} required={f.required}>
                <input
                    type="file"
                    accept={accept}
                    aria-label={f.label}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(file);
                    }}
                    className="text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent-weak file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong"
                />
                {uploaded ? (
                    <Notice tone="success">{strings.publicForm.fileAttached}</Notice>
                ) : null}
            </Field>
        );
    }

    if (f.input === "checkbox") {
        return <Toggle label={f.label} hint={help} value={value === true} onChange={onChange} />;
    }

    if (f.input === "select") {
        return (
            <Select
                label={f.label}
                hint={help}
                value={typeof value === "string" ? value : ""}
                options={[
                    { key: "", label: strings.publicForm.selectPlaceholder },
                    ...f.options.map((opt) => {
                        const { value: v, label: l } = optionPair(opt);
                        return { key: v, label: l };
                    }),
                ]}
                onChange={onChange}
            />
        );
    }

    if (f.input === "multiselect") {
        const list = Array.isArray(value) ? value : [];
        return (
            <Field label={f.label} hint={help} required={f.required}>
                <Choice
                    label={f.label}
                    options={f.options.map((opt) => {
                        const { value: v, label: l } = optionPair(opt);
                        return { key: v, label: l };
                    })}
                    value={list}
                    onChange={(v) => {
                        onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
                    }}
                />
            </Field>
        );
    }

    if (f.input === "rating") {
        const current = typeof value === "string" ? Number(value) : 0;
        return (
            <Field label={f.label} hint={help} required={f.required}>
                <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            type="button"
                            aria-label={strings.publicReview.stars(n)}
                            onClick={() => {
                                onChange(String(n));
                            }}
                            className={`text-2xl ${n <= current ? "text-accent" : "text-line"}`}
                        >
                            ★
                        </button>
                    ))}
                </div>
            </Field>
        );
    }

    return (
        <TextField
            label={f.label}
            hint={help}
            required={f.required}
            multiline={f.input === "longtext" || f.input === "address"}
            type={
                f.input === "date"
                    ? "date"
                    : f.input === "time"
                      ? "time"
                      : f.input === "email"
                        ? "email"
                        : f.input === "phone"
                          ? "tel"
                          : f.input === "number" || f.input === "currency"
                            ? "number"
                            : "text"
            }
            value={typeof value === "string" ? value : ""}
            onChange={onChange}
        />
    );
}

function DoneState({
    businessName,
    brand = null,
}: {
    businessName: string;
    brand?: PublicBrand | null;
}) {
    return (
        <PublicFrame brand={brand}>
            <div className="py-4 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                    ✓
                </span>
                <h1 className="mt-4 font-display text-xl font-bold text-ink">
                    {strings.publicForm.doneTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">
                    {strings.publicForm.doneBody(businessName)}
                </p>
            </div>
        </PublicFrame>
    );
}
