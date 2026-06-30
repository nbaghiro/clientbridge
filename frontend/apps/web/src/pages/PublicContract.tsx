import {
    type PublicContract as PublicContractData,
    PublicContractError,
    createPublicContractClient,
    signatureStatusIntent,
    useAsyncAction,
} from "@clientbridge/app-core";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { StatusPill } from "../components/StatusPill";

const contracts = createPublicContractClient(
    import.meta.env.VITE_API_URL ?? "http://localhost:8701",
);

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function PublicContract() {
    const { token = "" } = useParams<{ token: string }>();

    const [contract, setContract] = useState<PublicContractData | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [typedName, setTypedName] = useState("");
    const [imageId, setImageId] = useState<string | null>(null);
    const [imageName, setImageName] = useState("");
    const action = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        contracts
            .getContract(token)
            .then((c) => {
                if (!live) return;
                setContract(c);
                if (c.signer_name !== null) setTypedName(c.signer_name);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicContractError && err.status === 404) setNotFound(true);
                else setLoadError("We couldn't load this contract. Please try again later.");
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [token]);

    if (loading) return <Frame>{<Centered>Loading…</Centered>}</Frame>;

    if (notFound)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Contract not found</h1>
                <p className="mt-2 text-sm text-muted">
                    This signing link is invalid or has expired. Please check with the business that
                    sent it to you.
                </p>
            </Frame>
        );

    if (loadError || contract === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">Something went wrong</h1>
                <p className="mt-2 text-sm text-muted">{loadError ?? "Please try again later."}</p>
            </Frame>
        );

    if (contract.status !== "pending") return <ResolvedState contract={contract} />;

    const sign = (e: FormEvent): void => {
        e.preventDefault();
        if (typedName.trim().length === 0 && imageId === null) {
            action.setError("Type your full name or upload a signature image to sign.");
            return;
        }
        void action.run(
            async () => {
                setContract(
                    await contracts.sign(token, {
                        typed_name: typedName.trim() || null,
                        signature_image_id: imageId,
                    }),
                );
            },
            { errorMessage: "We couldn't record your signature. Please try again." },
        );
    };

    const uploadImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (!file) return;
        void action.run(
            async () => {
                const id = await contracts.upload(token, file);
                setImageId(id);
                setImageName(file.name);
            },
            { errorMessage: "We couldn't upload that signature image. Please try again." },
        );
    };

    const decline = (): void => {
        void action.run(
            async () => {
                setContract(await contracts.decline(token));
            },
            { errorMessage: "We couldn't record that. Please try again." },
        );
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
                        value={typedName}
                        onChange={(e) => {
                            setTypedName(e.target.value);
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
                    {imageName !== "" ? (
                        <span className="text-xs text-ok-fg">Attached: {imageName}</span>
                    ) : null}
                </label>
                {action.error !== null ? (
                    <p className="text-sm text-danger-fg">{action.error}</p>
                ) : null}
                <div className="flex gap-2">
                    <button
                        type="submit"
                        disabled={action.busy}
                        className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {action.busy ? "Working…" : "Sign contract"}
                    </button>
                    <button
                        type="button"
                        onClick={decline}
                        disabled={action.busy}
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
