import { strings, useLogin } from "@clientbridge/app-core";
import { type FormEvent } from "react";

import { api } from "../lib/api";
import { setTokens } from "../lib/auth";
import { BrandBackdrop, resolveVariant } from "./BrandBackdrop";
import { GoogleIcon, Logo } from "./icons";

const backdrop = resolveVariant(new URLSearchParams(window.location.search).get("bg"));

export function Login({ onSuccess }: { onSuccess: () => void }) {
    const login = useLogin(api, setTokens, onSuccess, {
        defaultEmail: "hannah@birchbarkpets.ca",
        defaultPassword: "demo1234",
    });

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2.5 text-ink outline-none transition placeholder:text-muted focus:border-accent";

    return (
        <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
            <aside className="brand-aside relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
                <BrandBackdrop variant={backdrop} />

                <div className="relative flex items-center gap-2.5">
                    <Logo className="h-8 w-8 text-white" />
                    <span className="text-xl font-bold tracking-tight">Clientbridge</span>
                </div>

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
                    <div className="mb-8 flex items-center gap-2 lg:hidden">
                        <Logo className="h-7 w-7 text-accent" />
                        <span className="text-lg font-bold tracking-tight text-ink">
                            Clientbridge
                        </span>
                    </div>

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
                        onSubmit={(e: FormEvent) => {
                            e.preventDefault();
                            login.submit();
                        }}
                        className="mt-6 flex flex-col gap-4"
                    >
                        {login.mode === "signup" ? (
                            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                                {strings.auth.name}
                                <input
                                    value={login.name}
                                    onChange={(e) => {
                                        login.setName(e.target.value);
                                    }}
                                    placeholder={strings.auth.namePlaceholder}
                                    autoComplete="name"
                                    className={field}
                                />
                            </label>
                        ) : null}

                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            {strings.auth.email}
                            <input
                                type="email"
                                value={login.email}
                                onChange={(e) => {
                                    login.setEmail(e.target.value);
                                }}
                                placeholder={strings.auth.emailPlaceholder}
                                autoComplete="email"
                                className={field}
                            />
                        </label>

                        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
                            {strings.auth.password}
                            <input
                                type="password"
                                value={login.password}
                                onChange={(e) => {
                                    login.setPassword(e.target.value);
                                }}
                                placeholder={strings.auth.passwordPlaceholder}
                                autoComplete={
                                    login.mode === "signin" ? "current-password" : "new-password"
                                }
                                className={field}
                            />
                        </label>

                        {login.error ? (
                            <p className="text-sm text-danger-fg">{login.error}</p>
                        ) : null}

                        <button
                            type="submit"
                            disabled={login.busy}
                            className="mt-1 rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {login.busy
                                ? login.mode === "signin"
                                    ? strings.auth.signingIn
                                    : strings.auth.creatingAccount
                                : login.mode === "signin"
                                  ? strings.auth.signIn
                                  : strings.auth.createAccount}
                        </button>
                    </form>

                    <div className="my-5 flex items-center gap-3 text-xs text-muted">
                        <span className="h-px flex-1 bg-line" />
                        {strings.auth.or}
                        <span className="h-px flex-1 bg-line" />
                    </div>

                    <button
                        type="button"
                        onClick={login.googleUnavailable}
                        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
                    >
                        <GoogleIcon className="h-5 w-5" />
                        {strings.auth.continueWithGoogle}
                    </button>

                    <p className="mt-6 text-center text-sm text-muted">
                        {login.mode === "signin" ? strings.auth.newToApp : strings.auth.haveAccount}{" "}
                        <button
                            type="button"
                            onClick={login.flip}
                            className="font-semibold text-accent hover:underline"
                        >
                            {login.mode === "signin"
                                ? strings.auth.createAnAccount
                                : strings.auth.signIn}
                        </button>
                    </p>
                </div>
            </main>
        </div>
    );
}
