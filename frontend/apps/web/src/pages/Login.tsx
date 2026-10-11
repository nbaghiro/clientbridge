import { strings, useAuthForm, useRecoveryForm, useVerificationForm } from "@clientbridge/app-core";
import {
    Button,
    Checkbox,
    Choice,
    GoogleIcon,
    Icon,
    Lockup,
    Notice,
    TextField,
} from "@clientbridge/ui";
import { type ReactNode, type SubmitEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, identity } from "../lib/api";
import { expectSession, getUserId, heldInvite, hintSession, sessionHinted } from "../lib/auth";
import { webauthn } from "../lib/webauthn";
import { BrandBackdrop, resolveVariant } from "../components/BrandBackdrop";

const backdrop = resolveVariant(new URLSearchParams(window.location.search).get("bg"));
const a = strings.auth;

type Auth = ReturnType<typeof useAuthForm>;
type Recovery = ReturnType<typeof useRecoveryForm>;

function OrDivider() {
    return (
        <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            {a.or}
            <span className="h-px flex-1 bg-line" />
        </div>
    );
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
    return (
        <form
            noValidate
            onSubmit={(e: SubmitEvent) => {
                e.preventDefault();
                onSubmit();
            }}
            className="mt-6 flex flex-col gap-4"
        >
            {children}
        </form>
    );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
    return (
        <>
            {notice !== null ? (
                <Notice tone="info" banner>
                    {notice}
                </Notice>
            ) : null}
            {error !== null ? (
                <Notice tone="danger" banner>
                    {error}
                </Notice>
            ) : null}
        </>
    );
}

function BackToSignIn({ onPress }: { onPress: () => void }) {
    return (
        <Button variant="link" icon={<Icon name="chevronLeft" size={16} />} onPress={onPress}>
            {a.backToSignIn}
        </Button>
    );
}

function CredentialsCard({ auth, onForgot }: { auth: Auth; onForgot: () => void }) {
    const signup = auth.mode === "signup";
    return (
        <>
            <h1 className="font-display text-2xl font-bold text-ink">
                {signup ? a.signUpTitle : a.signInTitle}
            </h1>
            <p className="mt-1 text-sm text-muted">
                {signup ? a.signUpSubtitle : a.signInSubtitle}
            </p>

            <Form onSubmit={auth.submit}>
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
                    autoComplete={signup ? "email" : "username"}
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
                            <Button variant="link" onPress={onForgot}>
                                {a.forgot}
                            </Button>
                        )}
                    </div>
                </div>

                <Messages error={auth.error} notice={auth.notice} />

                <Button submit size="lg" full busy={auth.busy}>
                    {auth.busy
                        ? signup
                            ? a.creatingAccount
                            : a.signingIn
                        : signup
                          ? a.createAccount
                          : a.signIn}
                </Button>
            </Form>

            <OrDivider />
            <Button
                variant="outline"
                size="lg"
                full
                onPress={auth.google}
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

function MfaCard({ auth }: { auth: Auth }) {
    const others = auth.mfaMethods.filter((m) => m !== auth.mfaMethod);
    return (
        <>
            <h1 className="font-display text-2xl font-bold text-ink">{a.mfaTitle}</h1>
            <p className="mt-1 text-sm text-muted">{a.mfaSubtitle}</p>
            <Form onSubmit={auth.submit}>
                {auth.mfaMethod === "webauthn" ? (
                    <p className="text-sm text-ink-soft">{a.mfaWebauthn}</p>
                ) : (
                    <TextField
                        label={auth.mfaMethod === "totp" ? a.mfaTotp : a.mfaLookup}
                        value={auth.code}
                        onChange={auth.setCode}
                        placeholder={a.codePlaceholder}
                        autoComplete="one-time-code"
                        size="lg"
                        autoFocus
                        error={auth.fieldErrors.code}
                    />
                )}
                <Messages error={auth.error} notice={null} />
                <Button submit size="lg" full busy={auth.busy}>
                    {a.confirm}
                </Button>
            </Form>
            {others.length > 0 ? (
                <div className="mt-4">
                    <Choice
                        layout="chips"
                        options={others.map((m) => ({ key: m, label: a.mfaUse[m] }))}
                        onChange={auth.setMfaMethod}
                    />
                </div>
            ) : null}
            <div className="mt-6">
                <Button variant="link" onPress={auth.cancel}>
                    {a.notYou}
                </Button>
            </div>
        </>
    );
}

function CodeCard({
    title,
    body,
    code,
    setCode,
    error,
    notice,
    busy,
    cooldown,
    submit,
    resend,
    submitLabel,
    footer,
}: {
    title: string;
    body: string;
    code: string;
    setCode: (v: string) => void;
    error: string | null;
    notice: string | null;
    busy: boolean;
    cooldown: number;
    submit: () => void;
    resend: () => void;
    submitLabel: string;
    footer?: ReactNode;
}) {
    return (
        <>
            <Icon name="mail" size={32} className="mt-6 block text-ink-soft" />
            <h1 className="mt-5 font-display text-2xl font-bold text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            <Form onSubmit={submit}>
                <TextField
                    label={a.code}
                    value={code}
                    onChange={setCode}
                    placeholder={a.codePlaceholder}
                    autoComplete="one-time-code"
                    size="lg"
                    autoFocus
                />
                <Messages error={error} notice={notice} />
                <Button submit size="lg" full busy={busy}>
                    {submitLabel}
                </Button>
            </Form>
            <div className="mt-4 flex items-center justify-between">
                <Button variant="link" onPress={resend} disabled={cooldown > 0}>
                    {cooldown > 0 ? a.resendIn(cooldown) : a.resendCode}
                </Button>
                {footer}
            </div>
        </>
    );
}

function RecoveryCard({ recovery, onBack }: { recovery: Recovery; onBack: () => void }) {
    if (recovery.step === "code")
        return (
            <>
                <BackToSignIn onPress={onBack} />
                <CodeCard
                    title={a.resetCodeTitle}
                    body={a.resetCodeBody(recovery.email.trim())}
                    code={recovery.code}
                    setCode={recovery.setCode}
                    error={recovery.error ?? recovery.fieldErrors.code ?? null}
                    notice={null}
                    busy={recovery.busy}
                    cooldown={recovery.cooldown}
                    submit={recovery.submit}
                    resend={recovery.resend}
                    submitLabel={a.checkCode}
                />
            </>
        );
    const password = recovery.step === "password";
    return (
        <>
            {password ? null : <BackToSignIn onPress={onBack} />}
            <div className="mt-8">
                <h1 className="font-display text-2xl font-bold text-ink">
                    {password ? a.resetPasswordTitle : a.resetTitle}
                </h1>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                    {password ? a.resetPasswordSubtitle : a.resetSubtitle}
                </p>
            </div>
            <Form onSubmit={recovery.submit}>
                {password ? (
                    <TextField
                        label={a.newPassword}
                        type="password"
                        value={recovery.password}
                        onChange={recovery.setPassword}
                        autoComplete="new-password"
                        hint={a.passwordHint}
                        size="lg"
                        autoFocus
                        error={recovery.fieldErrors.password}
                    />
                ) : (
                    <TextField
                        label={a.email}
                        type="email"
                        value={recovery.email}
                        onChange={recovery.setEmail}
                        autoComplete="email"
                        size="lg"
                        autoFocus
                        error={recovery.fieldErrors.email}
                    />
                )}
                <Messages error={recovery.error} notice={null} />
                <Button submit size="lg" full busy={recovery.busy}>
                    {recovery.busy ? a.sending : password ? a.savePassword : a.sendCode}
                </Button>
            </Form>
        </>
    );
}

function Shell({ children }: { children: ReactNode }) {
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
                    {children}
                </div>
            </main>
        </div>
    );
}

const AUTH_PATHS = ["/", "/login", "/signup", "/recover", "/verify", "/auth-error"];

function SignIn({ onSuccess }: { onSuccess: () => void }) {
    const [params] = useSearchParams();
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    // A deep link the user opened signed out (an invoice, a settings page) is where they land.
    const landing =
        heldInvite() !== null
            ? "/accept-invite"
            : AUTH_PATHS.includes(pathname)
              ? "/"
              : `${pathname}${search}`;
    const returnTo = new URL(landing, window.location.origin);
    returnTo.searchParams.set("session", "1");
    const auth = useAuthForm(
        identity,
        () => {
            expectSession();
            const navigated = navigate(landing, { replace: true });
            if (navigated) navigated.catch(() => undefined);
            onSuccess();
        },
        {
            initialMode: pathname === "/signup" ? "signup" : "signin",
            defaultEmail: params.get("email") ?? "",
            returnTo: returnTo.toString(),
            probe: getUserId() !== null || params.has("session") || sessionHinted(),
            onSessionStarted: hintSession,
            openUrl: (url) => {
                window.location.assign(url);
                return Promise.resolve(null);
            },
            ...(webauthn ? { webauthn } : {}),
            ...(params.get("flow") ? { flowId: params.get("flow") ?? "" } : {}),
        },
    );

    if (auth.mode === "mfa") return <MfaCard auth={auth} />;
    if (auth.mode === "verify")
        return (
            <CodeCard
                title={a.verifyTitle}
                body={auth.email.trim() ? a.verifyBody(auth.email.trim()) : a.verifyBodyAnyEmail}
                code={auth.code}
                setCode={auth.setCode}
                error={auth.error ?? auth.fieldErrors.code ?? null}
                notice={null}
                busy={auth.busy}
                cooldown={auth.cooldown}
                submit={auth.submit}
                resend={auth.resend}
                submitLabel={a.verify}
                footer={
                    <Button variant="link" onPress={auth.skipVerification}>
                        {a.skipForNow}
                    </Button>
                }
            />
        );
    return (
        <CredentialsCard
            auth={auth}
            onForgot={() => {
                const navigated = navigate(
                    `/recover?email=${encodeURIComponent(auth.email.trim())}`,
                );
                if (navigated) navigated.catch(() => undefined);
            }}
        />
    );
}

function Recover({ onSuccess }: { onSuccess: () => void }) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const recovery = useRecoveryForm(
        identity,
        () => {
            expectSession();
            const navigated = navigate("/", { replace: true });
            if (navigated) navigated.catch(() => undefined);
            onSuccess();
        },
        {
            defaultEmail: params.get("email") ?? "",
            ...(params.get("flow") ? { flowId: params.get("flow") ?? "" } : {}),
        },
    );
    return (
        <RecoveryCard
            recovery={recovery}
            onBack={() => {
                const navigated = navigate("/login");
                if (navigated) navigated.catch(() => undefined);
            }}
        />
    );
}

/** Kratos's verify link lands here; it also works while signed in. */
export function VerifyEmail() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const flowId = params.get("flow");
    const verification = useVerificationForm(
        identity,
        flowId ? { flowId } : getUserId() !== null ? { api } : {},
    );
    const home = (): void => {
        const navigated = navigate(heldInvite() !== null ? "/accept-invite" : "/", {
            replace: true,
        });
        if (navigated) navigated.catch(() => undefined);
    };
    return (
        <Shell>
            {verification.verified ? (
                <>
                    <h1 className="font-display text-2xl font-bold text-ink">{a.verifyDone}</h1>
                    <div className="mt-6">
                        <Button size="lg" full onPress={home}>
                            {a.continue}
                        </Button>
                    </div>
                </>
            ) : (
                <CodeCard
                    title={a.verifyTitle}
                    body={a.verifyBodyAnyEmail}
                    code={verification.code}
                    setCode={verification.setCode}
                    error={verification.error}
                    notice={verification.notice}
                    busy={verification.busy}
                    cooldown={verification.cooldown}
                    submit={verification.submit}
                    resend={verification.resend}
                    submitLabel={a.verify}
                />
            )}
        </Shell>
    );
}

/** Kratos sends the browser here when a flow fails outside the app's screens. */
export function AuthError() {
    const navigate = useNavigate();
    return (
        <Shell>
            <h1 className="font-display text-2xl font-bold text-ink">{a.errorTitle}</h1>
            <p className="mt-1 text-sm text-muted">{a.errorBody}</p>
            <div className="mt-6">
                <Button
                    size="lg"
                    full
                    onPress={() => {
                        const navigated = navigate("/login", { replace: true });
                        if (navigated) navigated.catch(() => undefined);
                    }}
                >
                    {a.backToSignIn}
                </Button>
            </div>
        </Shell>
    );
}

export function Login({ onSuccess }: { onSuccess: () => void }) {
    const { pathname } = useLocation();
    return (
        <Shell>
            {pathname === "/recover" ? (
                <Recover onSuccess={onSuccess} />
            ) : (
                <SignIn onSuccess={onSuccess} />
            )}
        </Shell>
    );
}
