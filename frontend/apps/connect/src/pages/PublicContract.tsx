import {
    type PublicContract as PublicContractData,
    createPublicContractClient,
    signatureStatusIntent,
    strings,
    usePublicContractSign,
} from "@clientbridge/app-core/public";
import { Button, Field, Notice, StatusPill, TextField } from "@clientbridge/ui";
import type { SubmitEvent } from "react";
import { useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { isEmbedded, useEmbedSuccess } from "../embed";
import { config } from "../config";

const contracts = createPublicContractClient(config.apiUrl);

export function PublicContract() {
    const { token = "" } = useParams<{ token: string }>();
    const form = usePublicContractSign(contracts, token);
    const contract = form.contract;
    useEmbedSuccess(contract?.status === "signed", "contract");

    if (form.status === "loading") return <PublicStatus kind="loading" />;

    if (form.status === "not-found")
        return (
            <PublicStatus
                kind="notFound"
                title={strings.publicContract.notFoundTitle}
                body={strings.publicContract.notFoundBody}
            />
        );

    if (form.status === "error" || contract === null) return <PublicStatus kind="error" />;

    if (form.status === "resolved") return <ResolvedState contract={contract} />;

    const sign = (e: SubmitEvent): void => {
        e.preventDefault();
        form.sign();
    };

    const uploadImage = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file) form.uploadImage(file, file.name);
    };

    return (
        <PublicFrame size="2xl" brand={contract.brand}>
            <p className="text-sm text-muted">{contract.business_name}</p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink">
                {contract.contract_name}
            </h1>

            <div
                className={`mt-5 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg px-5 py-4 text-sm leading-relaxed text-ink-soft ${
                    isEmbedded() ? "max-h-[32rem]" : "max-h-[50vh]"
                }`}
            >
                {contract.body}
            </div>

            <form onSubmit={sign} className="mt-6 space-y-3">
                <TextField
                    label={strings.publicContract.typeNameToSign}
                    value={form.typedName}
                    onChange={form.setTypedName}
                    placeholder={strings.publicContract.fullNamePlaceholder}
                    autoComplete="name"
                />
                <Field label={strings.publicContract.uploadSignature}>
                    <input
                        type="file"
                        accept="image/*"
                        aria-label={strings.publicContract.uploadSignature}
                        onChange={uploadImage}
                        className="text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-accent-weak file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong"
                    />
                    {form.imageName !== "" ? (
                        <Notice tone="success">
                            {strings.publicContract.attached(form.imageName)}
                        </Notice>
                    ) : null}
                </Field>
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex gap-2">
                    <Button submit size="lg" grow busy={form.busy}>
                        {form.busy ? strings.common.working : strings.publicContract.sign}
                    </Button>
                    <Button variant="outline" size="lg" onPress={form.decline} disabled={form.busy}>
                        {strings.publicContract.decline}
                    </Button>
                </div>
                <p className="text-xs text-muted">{strings.publicContract.esignConsent}</p>
            </form>
        </PublicFrame>
    );
}

function ResolvedState({ contract }: { contract: PublicContractData }) {
    const signed = contract.status === "signed";
    return (
        <PublicDone
            brand={contract.brand}
            closed={!signed}
            title={
                signed ? strings.publicContract.signedStatus : strings.publicContract.declinedStatus
            }
            aside={
                <StatusPill
                    status={contract.status}
                    intent={signatureStatusIntent(contract.status)}
                />
            }
            body={
                signed
                    ? strings.publicContract.signedThanks(
                          contract.contract_name,
                          contract.business_name,
                      )
                    : strings.publicContract.declinedNote(
                          contract.contract_name,
                          contract.business_name,
                      )
            }
        />
    );
}
