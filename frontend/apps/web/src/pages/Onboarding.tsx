import {
    PROVINCES,
    pageDomain,
    industryOptions,
    strings,
    useOnboardingForm,
    useVerificationForm,
} from "@clientbridge/app-core";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, Lockup, Logo, Notice, Select, TextField } from "@clientbridge/ui";
import { config } from "../config";
import { api, identity } from "../lib/api";
import { heldInvite } from "../lib/auth";

const a = strings.auth;

function Start({
    title,
    subtitle,
    onSignOut,
    children,
}: {
    title: string;
    subtitle: string;
    onSignOut: () => void;
    children: ReactNode;
}) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
            <div className="w-full max-w-md">
                <Lockup className="mb-8 text-lg text-ink" />
                <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
                <p className="mt-1 text-sm text-muted">{subtitle}</p>
                {children}
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

/** A signed-in account confirms its email here before it can create a business or join one. */
export function ConfirmEmail({
    onConfirmed,
    onSignOut,
}: {
    onConfirmed: () => void;
    onSignOut: () => void;
}) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const flowId = params.get("flow");
    const v = useVerificationForm(identity, {
        ...(flowId ? { flowId } : {}),
        ...(config.dev ? { devApi: api.forBusiness(null) } : {}),
    });
    useEffect(() => {
        if (!v.verified) return;
        const navigated = navigate(heldInvite() !== null ? "/accept-invite" : "/", {
            replace: true,
        });
        if (navigated) navigated.catch(() => undefined);
        onConfirmed();
    }, [v.verified]);
    return (
        <Start
            title={a.verifyTitle}
            subtitle={v.email ? a.verifyBody(v.email) : a.verifyBodyAnyEmail}
            onSignOut={onSignOut}
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    v.submit();
                }}
                className="mt-6 flex flex-col gap-4"
            >
                <TextField
                    label={a.code}
                    value={v.code}
                    onChange={v.setCode}
                    placeholder={a.codePlaceholder}
                    autoComplete="one-time-code"
                    autoFocus
                    size="lg"
                />
                {v.error ? <Notice tone="danger">{v.error}</Notice> : null}
                <Button submit size="lg" full busy={v.busy}>
                    {a.verify}
                </Button>
            </form>
            <div className="mt-4 flex justify-center">
                <Button variant="link" onPress={v.resend} disabled={v.cooldown > 0}>
                    {v.cooldown > 0 ? a.resendIn(v.cooldown) : a.resendCode}
                </Button>
            </div>
        </Start>
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
        <Start
            title={strings.business.onboarding.title}
            subtitle={strings.business.onboarding.subtitleWeb}
            onSignOut={onSignOut}
        >
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

                <Button submit size="lg" full busy={form.busy}>
                    {form.busy
                        ? strings.business.onboarding.creating
                        : strings.business.onboarding.createBusiness}
                </Button>
            </form>
        </Start>
    );
}
