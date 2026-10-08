import {
    type PublicContract as PublicContractData,
    contractClauses,
    createPublicContractClient,
    formatDate,
    formatTime,
    parseTimestamp,
    strings,
    useContractSigning,
} from "@clientbridge/app-core/public";
import {
    Button,
    Choice,
    ContractDocument,
    Icon,
    Notice,
    SignaturePad,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useParams } from "react-router-dom";

import { DocumentLetter } from "../components/PublicDocument";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const contracts = createPublicContractClient(config.apiUrl);
const s = strings.publicContract;
const SCRIPT = { fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive' };

const stamp = (value: string): string => {
    const d = parseTimestamp(value);
    return `${formatDate(d)}, ${formatTime(d)}`;
};

export function PublicContract() {
    const { token = "" } = useParams<{ token: string }>();
    const signing = useContractSigning(contracts, token);
    const doc = signing.doc;
    useEmbedSuccess(signing.status === "signed", "contract");

    if (signing.status === "loading") return <PublicStatus kind="loading" />;
    if (signing.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (signing.status === "error" || doc === null)
        return (
            <PublicStatus
                kind="error"
                title={s.errorTitle}
                body={s.errorBody}
                onRetry={signing.retry}
            />
        );
    if (signing.status === "declined")
        return (
            <DocumentLetter
                brand={doc.brand}
                businessName={doc.business_name}
                title={s.declinedTitle}
                subtitle={s.declinedBody(doc.business_name)}
            >
                <div className="flex justify-center py-8 text-muted">
                    <Icon name="minus" size={48} />
                </div>
            </DocumentLetter>
        );
    if (signing.status === "signed") return <Signed doc={doc} />;

    const modes = [
        { key: "type" as const, label: s.typeTab },
        { key: "draw" as const, label: s.drawTab },
    ];
    return (
        <DocumentLetter
            brand={doc.brand}
            businessName={doc.business_name}
            title={doc.contract_name}
            subtitle={s.intro(doc.business_name)}
            facts={<p className="mt-3 text-xs text-muted">{s.version(doc.version)}</p>}
            actions={
                <>
                    {signing.error !== null && signing.error !== "name-missing" ? (
                        <Notice tone="danger">{s.errors[signing.error]}</Notice>
                    ) : null}
                    <Button size="lg" full busy={signing.busy} onPress={signing.sign}>
                        {signing.busy ? s.signing : s.sign}
                    </Button>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted">
                        <span className="flex items-center gap-1.5">
                            <Icon name="shield" size={13} />
                            {s.recorded}
                        </span>
                        <Button
                            variant="link"
                            size="sm"
                            onPress={signing.decline}
                            disabled={signing.busy}
                        >
                            {s.decline}
                        </Button>
                    </div>
                </>
            }
        >
            <div
                className="border-b border-line-soft -mx-6 -mt-6 px-3 py-3"
                tabIndex={0}
                aria-label={doc.contract_name}
            >
                <ContractDocument
                    density="compact"
                    issuer={doc.business_name}
                    title={doc.contract_name}
                    meta={s.version(doc.version)}
                    clauses={contractClauses(doc.body)}
                />
            </div>
            <div className="mt-7 space-y-5">
                <h2 className="font-display text-lg font-bold text-ink">{s.signTitle}</h2>
                <Choice
                    layout="segmented"
                    label={s.signTitle}
                    options={modes}
                    value={signing.mode}
                    onChange={signing.setMode}
                />
                <TextField
                    label={s.nameLabel}
                    value={signing.typedName}
                    onChange={signing.setTypedName}
                    placeholder={s.namePlaceholder}
                    autoComplete="name"
                    error={signing.error === "name-missing" ? s.errors["name-missing"] : null}
                />
                {signing.mode === "draw" ? (
                    <SignaturePad
                        strokes={signing.strokes}
                        onChange={signing.setStrokes}
                        label={s.drawLabel}
                        placeholder={s.drawPlaceholder}
                        clearLabel={s.clear}
                        height={150}
                    />
                ) : (
                    <div className="rounded-md border border-line bg-bg px-5 pb-3 pt-2">
                        <p className="text-xs text-muted">{s.preview}</p>
                        <p
                            style={SCRIPT}
                            aria-hidden
                            className={`mt-1 h-12 truncate text-4xl leading-[3rem] ${signing.typedName !== "" ? "text-ink" : "text-line"}`}
                        >
                            {signing.typedName || s.namePlaceholder}
                        </p>
                        <div className="mt-1 border-t border-dashed border-line" />
                    </div>
                )}
                <div
                    className={`rounded-md border px-3.5 py-3 ${signing.error === "consent-missing" ? "border-danger" : "border-line"}`}
                >
                    <Toggle
                        label={s.agree(doc.business_name)}
                        value={signing.agreed}
                        onChange={signing.setAgreed}
                    />
                </div>
            </div>
        </DocumentLetter>
    );
}

function Signed({ doc }: { doc: PublicContractData }) {
    return (
        <DocumentLetter
            brand={doc.brand}
            businessName={doc.business_name}
            title={s.signedTitle}
            subtitle={s.signedBody(doc.contract_name, doc.business_name)}
            actions={
                <>
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <Button
                            variant="outline"
                            icon="printer"
                            onPress={() => {
                                globalThis.print();
                            }}
                        >
                            {s.print}
                        </Button>
                    </div>
                </>
            }
        >
            <div className="mt-6 text-left">
                <ContractDocument
                    density="compact"
                    issuer={doc.business_name}
                    title={doc.contract_name}
                    meta={s.version(doc.version)}
                    clauses={contractClauses(doc.body.split("\n\n— Signed by ")[0] ?? doc.body)}
                    signature={{
                        heading: s.signatureHeading,
                        name: doc.typed_name ?? doc.signer_name ?? "",
                        strokes: doc.method === "drawn" ? doc.strokes : null,
                        facts: [
                            {
                                label: s.facts.signedAt,
                                value: doc.signed_at === null ? "" : stamp(doc.signed_at),
                            },
                            { label: s.facts.ip, value: doc.signer_ip ?? "" },
                            { label: s.facts.version, value: s.version(doc.version) },
                        ],
                    }}
                />
            </div>
        </DocumentLetter>
    );
}
