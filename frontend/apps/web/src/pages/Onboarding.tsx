import { PROVINCES, strings, useOnboardingForm } from "@clientbridge/app-core";
import { useState } from "react";

import { Logo } from "../components/icons";
import { api } from "../lib/api";

/** Create-your-business step: shown to an authenticated user who has no business yet (right after
 *  sign-up). On success the new business syncs down and the App routes through into the app. */
export function Onboarding({ onSignOut }: { onSignOut: () => void }) {
    const [submitted, setSubmitted] = useState(false);
    const form = useOnboardingForm(api, () => {
        setSubmitted(true);
    });

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-none transition placeholder:text-muted focus:border-accent";

    if (submitted) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-bg px-6">
                <div className="text-center">
                    <Logo className="mx-auto h-8 w-8 text-accent" />
                    <p className="mt-4 text-sm text-muted">{strings.onboarding.settingUp}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 flex items-center gap-2">
                    <Logo className="h-7 w-7 text-accent" />
                    <span className="text-lg font-bold tracking-tight text-ink">Clientbridge</span>
                </div>

                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.onboarding.title}
                </h1>
                <p className="mt-1 text-sm text-muted">{strings.onboarding.subtitleWeb}</p>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        form.submit();
                    }}
                    className="mt-6 flex flex-col gap-4"
                >
                    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                        {strings.onboarding.businessName}
                        <input
                            value={form.name}
                            onChange={(e) => {
                                form.setName(e.target.value);
                            }}
                            placeholder={strings.onboarding.businessNamePlaceholder}
                            autoFocus
                            className={field}
                        />
                    </label>

                    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                        {strings.onboarding.webAddress}
                        <div className="flex items-center overflow-hidden rounded-md border border-line bg-bg focus-within:border-accent">
                            <span className="pl-3 text-sm text-muted">
                                {strings.onboarding.slugPrefix}
                            </span>
                            <input
                                value={form.slug}
                                onChange={(e) => {
                                    form.setSlug(e.target.value);
                                }}
                                placeholder={strings.onboarding.slugPlaceholder}
                                className="flex-1 bg-transparent px-1 py-2.5 text-ink outline-none placeholder:text-muted"
                            />
                        </div>
                    </label>

                    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                        {strings.onboarding.province}
                        <select
                            value={form.province}
                            onChange={(e) => {
                                form.setProvince(e.target.value as typeof form.province);
                            }}
                            className={field}
                        >
                            {PROVINCES.map((p) => (
                                <option key={p.code} value={p.code}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    {form.error ? <p className="text-sm text-danger-fg">{form.error}</p> : null}

                    <button
                        type="submit"
                        disabled={form.busy}
                        className="mt-1 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy
                            ? strings.onboarding.creating
                            : strings.onboarding.createBusiness}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-muted">
                    {strings.onboarding.notYou}{" "}
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="font-semibold text-accent hover:underline"
                    >
                        {strings.onboarding.signOut}
                    </button>
                </p>
            </div>
        </div>
    );
}
