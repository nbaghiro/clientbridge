import { type AccountFields, useAccountForm } from "@clientbridge/app-core";

import { api } from "../lib/api";

const FIELD =
    "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-none transition placeholder:text-muted focus:border-accent";

const TEXT_FIELDS: { key: keyof AccountFields; label: string; placeholder: string }[] = [
    { key: "name", label: "Business name", placeholder: "" },
    { key: "timezone", label: "Time zone", placeholder: "America/Toronto" },
    { key: "billing_email", label: "Billing email", placeholder: "you@example.com" },
    { key: "gst_hst_number", label: "GST/HST number", placeholder: "123456789RT0001" },
    { key: "qst_number", label: "QST number", placeholder: "" },
];

export function Account() {
    const form = useAccountForm(api);
    const fields = form.fields;

    return (
        <div>
            <h1 className="font-display text-2xl font-bold text-ink">Account</h1>
            <p className="mt-1 text-sm text-muted">Your business profile and tax registration.</p>

            <div className="mt-6 max-w-lg rounded-lg border border-line bg-surface p-6">
                {fields === null ? (
                    <p className="text-sm text-muted">Loading…</p>
                ) : (
                    <form
                        className="space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            form.submit();
                        }}
                    >
                        {TEXT_FIELDS.map((f) => (
                            <label
                                key={f.key}
                                className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft"
                            >
                                {f.label}
                                <input
                                    type="text"
                                    value={fields[f.key]}
                                    onChange={(e) => {
                                        form.set(f.key, e.target.value);
                                    }}
                                    placeholder={f.placeholder}
                                    className={FIELD}
                                />
                            </label>
                        ))}
                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            Language
                            <select
                                value={fields.locale}
                                onChange={(e) => {
                                    form.set("locale", e.target.value);
                                }}
                                className={FIELD}
                            >
                                <option value="en">English</option>
                                <option value="fr">Français</option>
                            </select>
                        </label>
                        {form.error !== null && <p className="text-sm text-danger">{form.error}</p>}
                        {form.saved && <p className="text-sm text-success">Saved.</p>}
                        <button
                            type="submit"
                            disabled={form.busy}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy ? "Saving…" : "Save changes"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
