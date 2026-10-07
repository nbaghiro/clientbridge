import { PROVINCES, strings, taxSummary, useOnboardingForm } from "@clientbridge/app-core";
import { useState } from "react";

import { Button, Lockup, Logo, Notice, Select, TextField } from "@clientbridge/ui";
import { api } from "../lib/api";

export function Onboarding({ onSignOut }: { onSignOut: () => void }) {
    const [submitted, setSubmitted] = useState(false);
    const form = useOnboardingForm(api, () => {
        setSubmitted(true);
    });

    if (submitted) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-bg px-6">
                <div className="text-center">
                    <Logo className="mx-auto h-8 w-auto text-accent" />
                    <p className="mt-4 text-sm text-muted">
                        {strings.business.onboarding.settingUp}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-md">
                <Lockup className="mb-8 text-lg text-ink" />

                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.business.onboarding.title}
                </h1>
                <p className="mt-1 text-sm text-muted">{strings.business.onboarding.subtitleWeb}</p>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        form.submit();
                    }}
                    className="mt-6 flex flex-col gap-4"
                >
                    <TextField
                        label={strings.business.onboarding.businessName}
                        value={form.name}
                        onChange={form.setName}
                        placeholder={strings.business.onboarding.businessNamePlaceholder}
                        autoFocus
                        size="lg"
                    />
                    <TextField
                        label={strings.business.onboarding.webAddress}
                        prefix={strings.business.onboarding.slugPrefix}
                        value={form.slug}
                        onChange={form.setSlug}
                        placeholder={strings.business.onboarding.slugPlaceholder}
                        size="lg"
                    />
                    <Select
                        label={strings.business.onboarding.province}
                        value={form.province}
                        options={PROVINCES.map((p) => ({ key: p.code, label: p.name }))}
                        onChange={form.setProvince}
                        size="lg"
                    />
                    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
                        <p className="text-sm font-medium text-ink">
                            {strings.business.onboarding.taxTitle(
                                PROVINCES.find((p) => p.code === form.province)?.name ?? "",
                            )}
                            {": "}
                            {taxSummary(form.province)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                            {strings.business.onboarding.taxNone}
                        </p>
                    </div>

                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}

                    <Button submit size="lg" full busy={form.busy}>
                        {form.busy
                            ? strings.business.onboarding.creating
                            : strings.business.onboarding.createBusiness}
                    </Button>
                </form>

                <p className="mt-6 text-center text-sm text-muted">
                    {strings.business.onboarding.notYou}{" "}
                    <Button variant="link" onPress={onSignOut}>
                        {strings.business.onboarding.signOut}
                    </Button>
                </p>
            </div>
        </div>
    );
}
