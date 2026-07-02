import {
    type PublicBrand,
    type PublicContract as PublicContractData,
    createPublicContractClient,
    signatureStatusIntent,
    strings,
    usePublicContractSign,
} from "@clientbridge/app-core";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
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

    if (form.status === "loading")
        return <Frame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</Frame>;

    if (form.status === "not-found")
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicContract.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicContract.notFoundBody}</p>
            </Frame>
        );

    if (form.status === "error" || contract === null)
        return (
            <Frame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
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
        <Frame wide brand={contract.brand}>
            <p className="text-sm text-muted">{contract.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">
                {contract.contract_name}
            </h1>

            <div className="mt-5 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg px-5 py-4 text-sm leading-relaxed text-ink-soft">
                {contract.body}
            </div>

            <form onSubmit={sign} className="mt-6 space-y-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.publicContract.typeNameToSign}
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
                    {strings.publicContract.uploadSignature}
                    <input
                        type="file"
                        accept="image/*"
                        onChange={uploadImage}
                        className="text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent-weak file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong"
                    />
                    {form.imageName !== "" ? (
                        <span className="text-xs text-ok-fg">
                            {strings.publicContract.attached(form.imageName)}
                        </span>
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
                        {form.busy ? strings.common.working : strings.publicContract.sign}
                    </button>
                    <button
                        type="button"
                        onClick={form.decline}
                        disabled={form.busy}
                        className="rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        {strings.publicContract.decline}
                    </button>
                </div>
                <p className="text-xs text-muted">{strings.publicContract.esignConsent}</p>
            </form>
        </Frame>
    );
}

function ResolvedState({ contract }: { contract: PublicContractData }) {
    const signed = contract.status === "signed";
    return (
        <Frame brand={contract.brand}>
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
                        {signed
                            ? strings.publicContract.signedStatus
                            : strings.publicContract.declinedStatus}
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

function Frame({
    brand = null,
    children,
    wide = false,
}: {
    brand?: PublicBrand | null;
    children: React.ReactNode;
    wide?: boolean;
}) {
    return (
        <PublicFrame brand={brand} size={wide ? "2xl" : "md"}>
            {children}
        </PublicFrame>
    );
}
