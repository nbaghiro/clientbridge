import {
    type PublicContract as PublicContractData,
    createPublicContractClient,
    signatureStatusIntent,
    usePublicContractSign,
} from "@clientbridge/app-core";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";

import { StatusPill } from "../components/StatusPill";

const contracts = createPublicContractClient(
    import.meta.env.VITE_API_URL ?? "http://localhost:8701",
);

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicContract() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicContractSign(contracts, token);
    const contract = form.contract;

    if (form.status === "loading") return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (form.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Contract not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This signing link is invalid or has expired. Please check with the business that
                    sent it to you.
                </p>
            </Frame>
        );

    if (form.status === "error" || contract === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">Please try again later.</p>
            </Frame>
        );

    if (form.status === "resolved") return <ResolvedState contract={contract} />;

    const sign = (e: FormEvent): void => {
        e.preventDefault();
        form.sign();
    };

    const uploadImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file) form.uploadImage(file, file.name);
    };

    return (
        <Frame wide>
            <p className="text-sm text-muted">{contract.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">
                {contract.contract_name}
            </h1>

            <div className="mt-5 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg px-5 py-4 text-sm leading-relaxed text-ink-soft">
                {contract.body}
            </div>

            <form onSubmit={sign} className="mt-6 space-y-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    Type your full name to sign
                    <input
                        value={form.typedName}
                        onChange={(e) => {
                            form.setTypedName(e.target.value);
                        }}
                        placeholder="Full legal name"
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    Or upload a signature image
                    <input
                        type="file"
                        accept="image/*"
                        onChange={uploadImage}
                        className="text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent-weak file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong"
                    />
                    {form.imageName !== "" ? (
                        <span className="text-xs text-ok-fg">Attached: {form.imageName}</span>
                    ) : null}
                </label>
                {form.error !== null ? (
                    <p className="text-sm text-danger-fg">{form.error}</p>
                ) : null}
                <div className="flex gap-2">
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? "Working…" : "Sign contract"}
                    </button>
                    <button
                        type="button"
                        onClick={form.decline}
                        disabled={form.busy}
                        className="rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        Decline
                    </button>
                </div>
                <p className="text-xs text-muted">
                    By typing your name and signing, you agree this is your electronic signature.
                </p>
            </form>
        </Frame>
    );
}

function ResolvedState({ contract }: { contract: PublicContractData }) {
    const signed = contract.status === "signed";
    return (
        <Frame>
            <div className="py-4 text-center">
                <span
                    className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
                        signed ? "bg-ok-bg text-ok-fg" : "bg-bg text-muted"
                    }`}
                >
                    {signed ? "✓" : "—"}
                </span>
                <div className="mt-4 flex items-center justify-center gap-2">
                    <h1 className="font-display text-xl font-bold text-ink">
                        {signed ? "Contract signed" : "Contract declined"}
                    </h1>
                    <StatusPill
                        status={contract.status}
                        intent={signatureStatusIntent(contract.status)}
                    />
                </div>
                <p className="mt-2 text-sm text-muted">
                    {signed
                        ? `Thank you. Your signature on “${contract.contract_name}” for ${contract.business_name} is recorded.`
                        : `You declined “${contract.contract_name}”. Contact ${contract.business_name} if this was a mistake.`}
                </p>
            </div>
        </Frame>
    );
}

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
            <div
                className={`w-full rounded-xl border border-line bg-surface p-7 shadow-card ${
                    wide ? "max-w-2xl" : "max-w-md"
                }`}
            >
                {children}
            </div>
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
