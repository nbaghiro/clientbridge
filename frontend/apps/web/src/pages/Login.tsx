import { strings, useAuthForm } from "@clientbridge/app-core";
import { Button, Checkbox, GoogleIcon, Icon, Lockup, Notice, TextField } from "@clientbridge/ui";
import { type SubmitEvent } from "react";

import { api } from "../lib/api";
import { setTokens } from "../lib/auth";
import { BrandBackdrop, resolveVariant } from "../components/BrandBackdrop";

const backdrop = resolveVariant(new URLSearchParams(window.location.search).get("bg"));
const a = strings.auth;

type Auth = ReturnType<typeof useAuthForm>;

function OrDivider() {
    return (
        <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            {a.or}
            <span className="h-px flex-1 bg-line" />
        </div>
    );
}

function CredentialsCard({ auth }: { auth: Auth }) {
    const signup = auth.mode === "signup";
    return (
        <>
            <h1 className="font-display text-2xl font-bold text-ink">
                {signup ? a.signUpTitle : a.signInTitle}
            </h1>
            <p className="mt-1 text-sm text-muted">
                {signup ? a.signUpSubtitle : a.signInSubtitle}
            </p>

            <form
                noValidate
                onSubmit={(e: SubmitEvent) => {
                    e.preventDefault();
                    auth.submit();
                }}
                className="mt-6 flex flex-col gap-4"
            >
                {signup ? (
                    <TextField
                        label={a.name}
                        value={auth.name}
                        onChange={auth.setName}
                        placeholder={a.namePlaceholder}
                        autoComplete="name"
                        size="lg"
                        error={auth.fieldErrors.name}
                    />
                ) : null}
                <TextField
                    label={a.email}
                    type="email"
                    value={auth.email}
                    onChange={auth.setEmail}
                    placeholder={a.emailPlaceholder}
                    autoComplete="email"
                    size="lg"
                    error={auth.fieldErrors.email}
                />
                <div className="flex flex-col gap-2">
                    <TextField
                        label={signup ? a.newPassword : a.password}
                        type={auth.reveal ? "text" : "password"}
                        value={auth.password}
                        onChange={auth.setPassword}
                        placeholder={a.passwordPlaceholder}
                        autoComplete={signup ? "new-password" : "current-password"}
                        hint={signup ? a.passwordHint : undefined}
                        size="lg"
                        error={auth.fieldErrors.password}
                    />
                    <div className="flex items-center justify-between">
                        <Checkbox
                            label={a.showPassword}
                            value={auth.reveal}
                            onChange={auth.toggleReveal}
                        />
                        {signup ? null : (
                            <Button
                                variant="link"
                                onPress={() => {
                                    auth.setMode("reset");
                                }}
                            >
                                {a.forgot}
                            </Button>
                        )}
                    </div>
                </div>

                {auth.error !== null ? (
                    <Notice tone="danger" banner>
                        {auth.error}
                        {auth.attemptsLeft !== null ? (
                            <span className="mt-1 block text-xs opacity-80">
                                {a.attemptsLeft(auth.attemptsLeft)}
                            </span>
                        ) : null}
                    </Notice>
                ) : null}

                <Button submit size="lg" full busy={auth.busy} disabled={auth.locked && !signup}>
                    {auth.busy
                        ? signup
                            ? a.creatingAccount
                            : a.signingIn
                        : signup
                          ? a.createAccount
                          : a.signIn}
                </Button>
            </form>

            <OrDivider />
            <Button
                variant="outline"
                size="lg"
                full
                onPress={auth.googleUnavailable}
                icon={<GoogleIcon className="h-5 w-5" />}
            >
                {a.continueWithGoogle}
            </Button>
            {signup ? <p className="mt-4 text-center text-xs text-muted">{a.terms}</p> : null}

            <p className="mt-6 text-center text-sm text-muted">
                {signup ? a.haveAccount : a.newToApp}{" "}
                <Button
                    variant="link"
                    onPress={() => {
                        auth.setMode(signup ? "signin" : "signup");
                    }}
                >
                    {signup ? a.signIn : a.createAnAccount}
                </Button>
            </p>
        </>
    );
}

function EmailCard({ auth }: { auth: Auth }) {
    return (
        <>
            <Button
                variant="link"
                icon={<Icon name="chevronLeft" size={16} />}
                onPress={() => {
                    auth.setMode("signin");
                }}
            >
                {a.backToSignIn}
            </Button>
            {auth.mode === "sent" ? (
                <div className="mt-8">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-weak text-accent">
                        <Icon name="mail" size={22} />
                    </span>
                    <h1 className="mt-5 font-display text-2xl font-bold text-ink">{a.sentTitle}</h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        {a.sentBody(auth.email.trim())}
                    </p>
                    {auth.error !== null ? (
                        <div className="mt-4">
                            <Notice tone="danger">{auth.error}</Notice>
                        </div>
                    ) : null}
                    <div className="mt-6 flex gap-2">
                        <Button
                            variant="outline"
                            onPress={auth.resend}
                            disabled={auth.cooldown > 0}
                            busy={auth.busy}
                        >
                            {auth.cooldown > 0 ? a.resendIn(auth.cooldown) : a.resend}
                        </Button>
                    </div>
                </div>
            ) : (
                <form
                    noValidate
                    onSubmit={(e: SubmitEvent) => {
                        e.preventDefault();
                        auth.submit();
                    }}
                    className="mt-8 flex flex-col gap-4"
                >
                    <div>
                        <h1 className="font-display text-2xl font-bold text-ink">{a.resetTitle}</h1>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{a.resetSubtitle}</p>
                    </div>
                    <TextField
                        label={a.email}
                        type="email"
                        value={auth.email}
                        onChange={auth.setEmail}
                        autoComplete="email"
                        size="lg"
                        error={auth.fieldErrors.email}
                        autoFocus
                    />
                    {auth.error !== null ? <Notice tone="danger">{auth.error}</Notice> : null}
                    <Button submit size="lg" full busy={auth.busy}>
                        {auth.busy ? a.sending : a.sendLink}
                    </Button>
                </form>
            )}
        </>
    );
}

export function Login({ onSuccess }: { onSuccess: () => void }) {
    const signupPath = window.location.pathname === "/signup";
    const auth = useAuthForm(api, setTokens, onSuccess, {
        initialMode: signupPath ? "signup" : "signin",
        defaultEmail: signupPath ? "" : "hannah@birchbarkpets.ca",
        defaultPassword: signupPath ? "" : "demo1234",
    });
    const credentials = auth.mode === "signin" || auth.mode === "signup";

    return (
        <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
            <aside className="brand-aside relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
                <BrandBackdrop variant={backdrop} />

                <Lockup className="relative text-xl" markClassName="text-white" />

                <div className="relative">
                    <h2 className="font-display text-[2rem] font-bold leading-[1.15] tracking-tight">
                        {a.heroHeadlineLine1}
                        <br />
                        {a.heroHeadlineLine2}
                    </h2>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
                        {a.heroSubtitle}
                    </p>
                    <div className="mt-8 flex flex-wrap gap-2">
                        {a.heroFeatures.map((f) => (
                            <span
                                key={f}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/80"
                            >
                                {f}
                            </span>
                        ))}
                    </div>
                </div>
            </aside>

            <main className="flex items-center justify-center bg-surface px-6 py-12">
                <div className="w-full max-w-sm">
                    <Lockup className="mb-8 text-lg text-ink lg:hidden" />
                    {credentials ? <CredentialsCard auth={auth} /> : <EmailCard auth={auth} />}
                </div>
            </main>
        </div>
    );
}
