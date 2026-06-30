import {
    type FormAnswer,
    type PublicForm as PublicFormData,
    PublicFormError,
    type PublicFormField,
    createPublicFormClient,
    isAnswerMissing,
    isUnsupportedPublicField,
    useAsyncAction,
} from "@clientbridge/app-core";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const forms = createPublicFormClient(import.meta.env.VITE_API_URL ?? "http://localhost:8701");

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

type Answers = Record<string, FormAnswer>;

export function PublicForm() {
    const { token = "" } = useParams<{ token: string }>();

    const [form, setForm] = useState<PublicFormData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Answers>({});
    const action = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        forms
            .getForm(token)
            .then((f) => {
                if (live) setForm(f);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicFormError && err.status === 404) setNotFound(true);
                else setLoadError("We couldn't load this form. Please try again later.");
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [token]);

    if (loading) return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (notFound)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Form not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This link is invalid or has expired. Please check with the business that sent it
                    to you.
                </p>
            </Frame>
        );

    if (loadError || form === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">{loadError ?? "Please try again later."}</p>
            </Frame>
        );

    if (form.completed) return <DoneState businessName={form.business_name} />;

    const setAnswer = (name: string, value: FormAnswer): void => {
        setAnswers((a) => ({ ...a, [name]: value }));
        action.setError(null);
    };

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        const missing = form.fields.find((f) => f.required && isAnswerMissing(answers[f.name]));
        if (missing !== undefined) {
            action.setError(
                isUnsupportedPublicField(missing.type)
                    ? `“${missing.label}” can't be completed on this link — contact the business.`
                    : `“${missing.label}” is required.`,
            );
            return;
        }
        void action.run(
            async () => {
                setForm(await forms.submit(token, answers));
            },
            { errorMessage: "We couldn't submit your answers. Please try again." },
        );
    };

    return (
        <Frame wide>
            <p className="text-sm text-muted">{form.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">{form.form_name}</h1>

            <form onSubmit={submit} className="mt-6 space-y-5">
                {form.fields.map((f) => (
                    <FieldView
                        key={f.id}
                        field={f}
                        value={answers[f.name]}
                        onChange={(v) => {
                            setAnswer(f.name, v);
                        }}
                    />
                ))}
                {action.error !== null ? (
                    <p className="text-sm text-danger-fg">{action.error}</p>
                ) : null}
                <button
                    type="submit"
                    disabled={action.busy}
                    className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {action.busy ? "Submitting…" : "Submit"}
                </button>
            </form>
        </Frame>
    );
}

function optionPair(option: unknown): { value: string; label: string } {
    if (typeof option === "string") return { value: option, label: option };
    if (typeof option === "number" || typeof option === "boolean") {
        const s = String(option);
        return { value: s, label: s };
    }
    if (typeof option === "object" && option !== null) {
        const o = option as { value?: unknown; label?: unknown };
        const value = typeof o.value === "string" ? o.value : "";
        const label = typeof o.label === "string" ? o.label : value;
        return { value, label };
    }
    return { value: "", label: "" };
}

function FieldView({
    field: f,
    value,
    onChange,
}: {
    field: PublicFormField;
    value: FormAnswer | undefined;
    onChange: (v: FormAnswer) => void;
}) {
    const label = (
        <span className="text-sm font-medium text-ink-soft">
            {f.label}
            {f.required ? <span className="text-danger"> *</span> : null}
        </span>
    );
    const help = f.help !== null ? <span className="text-xs text-muted">{f.help}</span> : null;

    if (isUnsupportedPublicField(f.type)) {
        return (
            <div className="flex flex-col gap-1">
                {label}
                <p className="rounded-md border border-dashed border-line bg-bg px-3 py-2 text-xs text-muted">
                    This field can't be completed on the online form — the business will collect it
                    directly.
                </p>
            </div>
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
                    <option value="">Select…</option>
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

function DoneState({ businessName }: { businessName: string }) {
    return (
        <Frame>
            <div className="py-4 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                    ✓
                </span>
                <h1 className="mt-4 font-display text-xl font-bold text-ink">Thanks — all done</h1>
                <p className="mt-2 text-sm text-muted">
                    Your responses have been sent to {businessName}.
                </p>
            </div>
        </Frame>
    );
}

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div
                className={`w-full rounded-xl border border-line bg-surface p-7 shadow-card ${
                    wide ? "max-w-xl" : "max-w-md"
                }`}
            >
                {children}
            </div>
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
