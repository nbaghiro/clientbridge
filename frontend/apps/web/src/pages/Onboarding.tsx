import {
    BUSINESS_NAME_MAX,
    PROVINCES,
    pageDomain,
    industryOptions,
    strings,
    useOnboardingForm,
    useVerificationForm,
} from "@clientbridge/app-core";
import { useEffect, useState } from "react";

import { Button, Lockup, Logo, Notice, Select, TextField } from "@clientbridge/ui";
import { config } from "../config";
import { api, identity } from "../lib/api";

const a = strings.auth;

/** Confirms the email in place, so what was typed into the form stays there. */
function ConfirmEmail({ onVerified }: { onVerified: () => void }) {
    const v = useVerificationForm(identity, {});
    useEffect(() => {
        if (v.verified) onVerified();
    }, [v.verified, onVerified]);
    if (v.verified) return <Notice tone="success">{a.verifyDone}</Notice>;
    return (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            {v.notice !== null ? <Notice tone="info">{v.notice}</Notice> : null}
            <TextField
                label={a.code}
                value={v.code}
                onChange={v.setCode}
                onSubmit={v.submit}
                placeholder={a.codePlaceholder}
                autoComplete="one-time-code"
                autoFocus
            />
            {v.error !== null ? <Notice tone="danger">{v.error}</Notice> : null}
            <Button variant="outline" full onPress={v.submit} busy={v.busy}>
                {a.verify}
            </Button>
            <Button variant="link" onPress={v.resend} disabled={v.cooldown > 0}>
                {v.cooldown > 0 ? a.resendIn(v.cooldown) : a.resendCode}
            </Button>
        </div>
    );
}

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
                        maxLength={BUSINESS_NAME_MAX}
                        autoFocus
                        size="lg"
                    />
                    <TextField
                        label={strings.business.onboarding.webAddress}
                        suffix={strings.business.onboarding.slugSuffix(pageDomain(config.pageUrl))}
                        value={form.slug}
                        onChange={form.setSlug}
                        placeholder={strings.business.onboarding.slugPlaceholder}
                        size="lg"
                    />
                    <Select
                        label={strings.business.onboarding.province}
                        value={form.province ?? undefined}
                        placeholder={strings.business.onboarding.provincePlaceholder}
                        options={PROVINCES.map((p) => ({ key: p.code, label: p.name }))}
                        onChange={form.setProvince}
                        size="lg"
                    />
                    {form.taxSummary !== null ? (
                        <div className="rounded-md border border-line bg-surface px-3 py-2.5">
                            <p className="text-sm font-medium text-ink">
                                {strings.business.onboarding.taxTitle(
                                    PROVINCES.find((p) => p.code === form.province)?.name ?? "",
                                )}
                                {": "}
                                {form.taxSummary}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">
                                {strings.business.onboarding.taxNone}
                            </p>
                        </div>
                    ) : null}
                    <Select
                        label={strings.business.onboarding.industryLabel}
                        hint={strings.business.onboarding.industryHint}
                        value={form.industry ?? undefined}
                        placeholder={strings.business.onboarding.industryPlaceholder}
                        options={industryOptions()}
                        onChange={form.setIndustry}
                        size="lg"
                    />

                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}
                    {form.needsVerification ? (
                        <ConfirmEmail onVerified={form.emailConfirmed} />
                    ) : null}

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
