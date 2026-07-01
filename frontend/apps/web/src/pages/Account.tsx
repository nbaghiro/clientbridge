import { ACCOUNT_TEXT_FIELDS, LOCALES, strings, useAccountForm } from "@clientbridge/app-core";

import { api } from "../lib/api";

const FIELD =
    "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-none transition placeholder:text-muted focus:border-accent";

export function Account() {
    const form = useAccountForm(api);
    const fields = form.fields;

    return (
        <div>
            <h1 className="font-display text-2xl font-bold text-ink">{strings.account.title}</h1>
            <p className="mt-1 text-sm text-muted">{strings.account.subtitle}</p>

            <div className="mt-6 max-w-lg rounded-lg border border-line bg-surface p-6">
                {fields === null ? (
                    <p className="text-sm text-muted">{strings.common.loading}</p>
                ) : (
                    <form
                        className="space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            form.submit();
                        }}
                    >
                        {ACCOUNT_TEXT_FIELDS.map((f) => (
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
                        {LOCALES.length > 1 ? (
                            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                                {strings.account.language}
                                <select
                                    value={fields.locale}
                                    onChange={(e) => {
                                        form.set("locale", e.target.value);
                                    }}
                                    className={FIELD}
                                >
                                    {LOCALES.map((l) => (
                                        <option key={l.code} value={l.code}>
                                            {l.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                        {form.error !== null && <p className="text-sm text-danger">{form.error}</p>}
                        {form.saved && (
                            <p className="text-sm text-success">{strings.common.saved}</p>
                        )}
                        <button
                            type="submit"
                            disabled={form.busy}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy ? strings.common.saving : strings.common.save}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
