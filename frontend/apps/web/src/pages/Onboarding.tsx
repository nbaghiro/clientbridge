import { PROVINCES, strings, useOnboardingForm } from "@clientbridge/app-core";
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
                    <p className="mt-4 text-sm text-muted">{strings.onboarding.settingUp}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-md">
                <Lockup className="mb-8 text-lg text-ink" />

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
                    <TextField
                        label={strings.onboarding.businessName}
                        value={form.name}
                        onChange={form.setName}
                        placeholder={strings.onboarding.businessNamePlaceholder}
                        autoFocus
                        size="lg"
                    />
                    <TextField
                        label={strings.onboarding.webAddress}
                        prefix={strings.onboarding.slugPrefix}
                        value={form.slug}
                        onChange={form.setSlug}
                        placeholder={strings.onboarding.slugPlaceholder}
                        size="lg"
                    />
                    <Select
                        label={strings.onboarding.province}
                        value={form.province}
                        options={PROVINCES.map((p) => ({ key: p.code, label: p.name }))}
                        onChange={form.setProvince}
                        size="lg"
                    />

                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}

                    <Button submit size="lg" full busy={form.busy}>
                        {form.busy
                            ? strings.onboarding.creating
                            : strings.onboarding.createBusiness}
                    </Button>
                </form>

                <p className="mt-6 text-center text-sm text-muted">
                    {strings.onboarding.notYou}{" "}
                    <Button variant="link" onPress={onSignOut}>
                        {strings.onboarding.signOut}
                    </Button>
                </p>
            </div>
        </div>
    );
}
