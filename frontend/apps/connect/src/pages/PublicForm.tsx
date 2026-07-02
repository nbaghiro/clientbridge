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
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { useEmbedSuccess } from "../embed";

const forms = createPublicFormClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicForm() {
    const { token = "" } = useParams<{ token: string }>();
    const fill = usePublicFormFill(forms, token);
    const form = fill.form;
    const answers = fill.answers;
    useEmbedSuccess(fill.status === "done", "form");

    if (fill.status === "loading")
        return <Frame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</Frame>;

    if (fill.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicForm.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicForm.notFoundBody}</p>
            </Frame>
        );

    if (fill.status === "error" || form === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </Frame>
        );

    if (fill.status === "done")
        return <DoneState businessName={form.business_name} brand={form.brand} />;

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        fill.submit();
    };

    return (
        <Frame wide brand={form.brand}>
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
                {fill.error !== null ? (
                    <p className="text-sm text-danger-fg">{fill.error}</p>
                ) : null}
                <button
                    type="submit"
                    disabled={fill.busy}
                    className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {fill.busy ? strings.publicForm.submitting : strings.publicForm.submit}
                </button>
            </form>
        </Frame>
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
    const label = (
        <span className="text-sm font-medium text-ink-soft">
            {f.label}
            {f.required ? <span className="text-danger"> *</span> : null}
        </span>
    );
    const help = f.help !== null ? <span className="text-xs text-muted">{f.help}</span> : null;

    if (isFileField(f.type)) {
        const uploaded = typeof value === "string" && value.length > 0;
        const accept = f.type === "image" || f.type === "signature" ? "image/*" : "*/*";
        return (
            <label className="flex flex-col gap-1">
                {label}
                {help}
                <input
                    type="file"
                    accept={accept}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(file);
                    }}
                    className="text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent-weak file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong"
                />
                {uploaded ? (
                    <span className="text-xs text-ok-fg">{strings.publicForm.fileAttached}</span>
                ) : null}
            </label>
        );
    }

    if (f.type === "checkbox") {
        return (
            <label className="flex items-start gap-2">
                <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => {
                        onChange(e.target.checked);
                    }}
                    className="mt-0.5 h-4 w-4"
                />
                <span className="flex flex-col gap-0.5">
                    {label}
                    {help}
                </span>
            </label>
        );
    }

    if (f.type === "select") {
        const str = typeof value === "string" ? value : "";
        return (
            <label className="flex flex-col gap-1">
                {label}
                {help}
                <select
                    value={str}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.publicForm.selectPlaceholder}</option>
                    {f.options.map((opt, i) => {
                        const { value: v, label: l } = optionPair(opt);
                        return (
                            <option key={`${v}-${i}`} value={v}>
                                {l}
                            </option>
                        );
                    })}
                </select>
            </label>
        );
    }

    if (f.type === "multiselect") {
        const list = Array.isArray(value) ? value : [];
        const toggle = (v: string): void => {
            onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
        };
        return (
            <div className="flex flex-col gap-1">
                {label}
                {help}
                <div className="flex flex-wrap gap-2">
                    {f.options.map((opt, i) => {
                        const { value: v, label: l } = optionPair(opt);
                        const on = list.includes(v);
                        return (
                            <button
                                key={`${v}-${i}`}
                                type="button"
                                onClick={() => {
                                    toggle(v);
                                }}
                                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                                    on
                                        ? "border-accent bg-accent-weak text-accent-strong"
                                        : "border-line text-ink-soft hover:bg-bg"
                                }`}
                            >
                                {l}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (f.type === "rating") {
        const current = typeof value === "string" ? Number(value) : 0;
        return (
            <div className="flex flex-col gap-1">
                {label}
                {help}
                <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            type="button"
                            aria-label={`${n} star${n === 1 ? "" : "s"}`}
                            onClick={() => {
                                onChange(String(n));
                            }}
                            className={`text-2xl ${n <= current ? "text-accent" : "text-line"}`}
                        >
                            ★
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const str = typeof value === "string" ? value : "";
    const multiline = f.type === "longtext" || f.type === "address";
    const inputType =
        f.type === "date"
            ? "date"
            : f.type === "time"
              ? "time"
              : f.type === "email"
                ? "email"
                : "text";
    const inputMode =
        f.type === "number" || f.type === "currency"
            ? "decimal"
            : f.type === "phone"
              ? "tel"
              : f.type === "email"
                ? "email"
                : undefined;

    return (
        <label className="flex flex-col gap-1">
            {label}
            {help}
            {multiline ? (
                <textarea
                    value={str}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    rows={3}
                    className={`${field} resize-none`}
                />
            ) : (
                <input
                    type={inputType}
                    inputMode={inputMode}
                    value={str}
                    onChange={(e) => {
                        onChange(e.target.value);
                    }}
                    className={field}
                />
            )}
        </label>
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
        <Frame brand={brand}>
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
        </Frame>
    );
}

function Frame({
    brand = null,
    children,
    wide = false,
}: {
    brand?: PublicBrand | null;
    children: React.ReactNode;
    wide?: boolean;
}) {
    return (
        <PublicFrame brand={brand} size={wide ? "xl" : "md"}>
            {children}
        </PublicFrame>
    );
}
