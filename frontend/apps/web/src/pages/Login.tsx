import { strings, useLogin } from "@clientbridge/app-core";
import { type SubmitEvent } from "react";

import { api } from "../lib/api";
import { setTokens } from "../lib/auth";
import { BrandBackdrop, resolveVariant } from "../components/BrandBackdrop";
import { Button, GoogleIcon, Lockup, Notice, TextField } from "@clientbridge/ui";

const backdrop = resolveVariant(new URLSearchParams(window.location.search).get("bg"));

export function Login({ onSuccess }: { onSuccess: () => void }) {
    const login = useLogin(api, setTokens, onSuccess, {
        defaultEmail: "hannah@birchbarkpets.ca",
        defaultPassword: "demo1234",
    });

    return (
        <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
            <aside className="brand-aside relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
                <BrandBackdrop variant={backdrop} />

                <Lockup className="relative text-xl" markClassName="text-white" />

                <div className="relative">
                    <h2 className="font-display text-[2rem] font-bold leading-[1.15] tracking-tight">
                        {strings.auth.heroHeadlineLine1}
                        <br />
                        {strings.auth.heroHeadlineLine2}
                    </h2>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
                        {strings.auth.heroSubtitle}
                    </p>
                    <div className="mt-8 flex flex-wrap gap-2">
                        {strings.auth.heroFeatures.map((f) => (
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

                    <h1 className="font-display text-2xl font-bold text-ink">
                        {login.mode === "signin"
                            ? strings.auth.signInTitle
                            : strings.auth.signUpTitle}
                    </h1>
                    <p className="mt-1 text-sm text-muted">
                        {login.mode === "signin"
                            ? strings.auth.signInSubtitle
                            : strings.auth.signUpSubtitle}
                    </p>

                    <form
                        onSubmit={(e: SubmitEvent) => {
                            e.preventDefault();
                            login.submit();
                        }}
                        className="mt-6 flex flex-col gap-4"
                    >
                        {login.mode === "signup" ? (
                            <TextField
                                label={strings.auth.name}
                                value={login.name}
                                onChange={login.setName}
                                placeholder={strings.auth.namePlaceholder}
                                autoComplete="name"
                                size="lg"
                            />
                        ) : null}

                        <TextField
                            label={strings.auth.email}
                            type="email"
                            value={login.email}
                            onChange={login.setEmail}
                            placeholder={strings.auth.emailPlaceholder}
                            autoComplete="email"
                            size="lg"
                        />
                        <TextField
                            label={strings.auth.password}
                            type="password"
                            value={login.password}
                            onChange={login.setPassword}
                            placeholder={strings.auth.passwordPlaceholder}
                            autoComplete={
                                login.mode === "signin" ? "current-password" : "new-password"
                            }
                            size="lg"
                        />

                        {login.error ? <Notice tone="danger">{login.error}</Notice> : null}

                        <Button submit size="lg" full busy={login.busy}>
                            {login.busy
                                ? login.mode === "signin"
                                    ? strings.auth.signingIn
                                    : strings.auth.creatingAccount
                                : login.mode === "signin"
                                  ? strings.auth.signIn
                                  : strings.auth.createAccount}
                        </Button>
                    </form>

                    <div className="my-5 flex items-center gap-3 text-xs text-muted">
                        <span className="h-px flex-1 bg-line" />
                        {strings.auth.or}
                        <span className="h-px flex-1 bg-line" />
                    </div>

                    <Button
                        variant="outline"
                        size="lg"
                        full
                        onPress={login.googleUnavailable}
                        icon={<GoogleIcon className="h-5 w-5" />}
                    >
                        {strings.auth.continueWithGoogle}
                    </Button>

                    <p className="mt-6 text-center text-sm text-muted">
                        {login.mode === "signin" ? strings.auth.newToApp : strings.auth.haveAccount}{" "}
                        <Button variant="link" onPress={login.flip}>
                            {login.mode === "signin"
                                ? strings.auth.createAnAccount
                                : strings.auth.signIn}
                        </Button>
                    </p>
                </div>
            </main>
        </div>
    );
}
