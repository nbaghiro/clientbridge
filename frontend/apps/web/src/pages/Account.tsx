import {
    ACCOUNT_TEXT_FIELDS,
    LOCALES,
    logoTarget,
    strings,
    useAccountForm,
    useFileUpload,
} from "@clientbridge/app-core";
import { type ChangeEvent, useRef } from "react";

import { Button, Field, Loading, Notice, Panel, Select, TextField } from "@clientbridge/ui";
import { api, apiBaseUrl } from "../lib/api";

export function Account() {
    const form = useAccountForm(api);
    const fields = form.fields;

    return (
        <div>
            <p className="mt-1 text-sm text-muted">{strings.account.subtitle}</p>

            <div className="mt-6 max-w-lg">
                <Panel>
                    {fields === null ? (
                        <Loading inline />
                    ) : (
                        <form
                            className="space-y-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                form.submit();
                            }}
                        >
                            {ACCOUNT_TEXT_FIELDS.map((f) => (
                                <TextField
                                    key={f.key}
                                    label={f.label}
                                    value={fields[f.key]}
                                    onChange={(v) => {
                                        form.set(f.key, v);
                                    }}
                                    placeholder={f.placeholder}
                                    size="lg"
                                />
                            ))}
                            {LOCALES.length > 1 ? (
                                <Select
                                    label={strings.account.language}
                                    value={fields.locale}
                                    options={LOCALES.map((l) => ({ key: l.code, label: l.label }))}
                                    onChange={(v) => {
                                        form.set("locale", v);
                                    }}
                                    size="lg"
                                />
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
                                    <Field label={strings.account.primaryLabel}>
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
                                            <TextField
                                                name={strings.account.primaryLabel}
                                                value={fields.primary}
                                                onChange={(v) => {
                                                    form.set("primary", v);
                                                }}
                                                placeholder={strings.account.primaryPlaceholder}
                                                size="lg"
                                            />
                                        </div>
                                    </Field>
                                    <TextField
                                        label={strings.account.taglineLabel}
                                        value={fields.tagline}
                                        onChange={(v) => {
                                            form.set("tagline", v);
                                        }}
                                        placeholder={strings.account.taglinePlaceholder}
                                        size="lg"
                                    />
                                </div>
                            </div>
                            {form.error !== null && <Notice tone="danger">{form.error}</Notice>}
                            {form.saved && <Notice tone="success">{strings.common.saved}</Notice>}
                            <Button submit busy={form.busy}>
                                {form.busy ? strings.common.saving : strings.common.save}
                            </Button>
                        </form>
                    )}
                </Panel>
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
        <Field label={strings.files.logo} error={error}>
            <div className="flex items-center gap-4">
                {src !== null ? (
                    <img src={src} alt="" className="h-12 max-w-48 rounded-md object-contain" />
                ) : null}
                <Button
                    variant="outline"
                    busy={busy}
                    onPress={() => {
                        inputRef.current?.click();
                    }}
                >
                    {busy
                        ? strings.files.uploading
                        : src !== null
                          ? strings.files.replaceLogo
                          : strings.files.uploadLogo}
                </Button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={onChange}
                    className="hidden"
                />
            </div>
        </Field>
    );
}
