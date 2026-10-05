import {
    ACCOUNT_TEXT_FIELDS,
    LOCALES,
    logoTarget,
    strings,
    useAccountForm,
    useFileUpload,
} from "@clientbridge/app-core";
import { type ChangeEvent, useRef } from "react";

import { api, apiBaseUrl } from "../lib/api";

const FIELD =
    "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-hidden transition placeholder:text-muted focus:border-accent";

export function Account() {
    const form = useAccountForm(api);
    const fields = form.fields;

    return (
        <div>
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
                        <div className="border-t border-line pt-4">
                            <h2 className="font-display text-sm font-semibold text-ink">
                                {strings.account.brandTitle}
                            </h2>
                            <p className="mt-0.5 text-xs text-muted">
                                {strings.account.brandSubtitle}
                            </p>
                            <div className="mt-3 space-y-4">
                                {form.businessId !== null ? (
                                    <LogoField
                                        src={form.logoSrc(apiBaseUrl)}
                                        businessId={form.businessId}
                                        onUploaded={(id) => {
                                            form.set("logo_file_id", id);
                                        }}
                                    />
                                ) : null}
                                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                                    {strings.account.primaryLabel}
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={fields.primary || "#3f5e80"}
                                            onChange={(e) => {
                                                form.set("primary", e.target.value);
                                            }}
                                            aria-label={strings.account.primaryLabel}
                                            className="h-10 w-14 shrink-0 rounded-md border border-line bg-bg"
                                        />
                                        <input
                                            type="text"
                                            value={fields.primary}
                                            onChange={(e) => {
                                                form.set("primary", e.target.value);
                                            }}
                                            placeholder={strings.account.primaryPlaceholder}
                                            className={FIELD}
                                        />
                                    </div>
                                </label>
                                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                                    {strings.account.taglineLabel}
                                    <input
                                        type="text"
                                        value={fields.tagline}
                                        onChange={(e) => {
                                            form.set("tagline", e.target.value);
                                        }}
                                        placeholder={strings.account.taglinePlaceholder}
                                        className={FIELD}
                                    />
                                </label>
                            </div>
                        </div>
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

function LogoField({
    src,
    businessId,
    onUploaded,
}: {
    src: string | null;
    businessId: string;
    onUploaded: (fileId: string) => void;
}) {
    const { busy, error, upload } = useFileUpload(api, onUploaded);
    const inputRef = useRef<HTMLInputElement>(null);

    const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file === undefined) return;
        upload(file, logoTarget(businessId), file.type !== "" ? file.type : "image/png", file.size);
        e.target.value = "";
    };

    return (
        <div className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
            {strings.files.logo}
            <div className="flex items-center gap-4">
                {src !== null ? (
                    <img src={src} alt="" className="h-12 max-w-48 rounded-md object-contain" />
                ) : null}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        inputRef.current?.click();
                    }}
                    className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                >
                    {busy
                        ? strings.files.uploading
                        : src !== null
                          ? strings.files.replaceLogo
                          : strings.files.uploadLogo}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={onChange}
                    className="hidden"
                />
            </div>
            {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
    );
}
