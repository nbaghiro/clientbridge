import { type PaymentMethodFormProps, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { CopyField } from "./CopyField";
import { CardForm } from "./CardForm";
import { Notice } from "./Notice";
import type { WebProps } from "./props";

export function PaymentMethodForm({
    flow,
    allowBank,
    className,
}: WebProps<PaymentMethodFormProps>) {
    const s = strings.checkout;
    if (flow.intent !== null && flow.kind === "card") {
        const noun = strings.clients.cardNoun;
        return (
            <CardForm
                className={className}
                clientSecret={flow.intent.client_secret}
                stripeAccount={flow.intent.stripe_account_id}
                mode="setup"
                submitLabel={strings.clients.saveMethod(noun)}
                busyLabel={strings.common.saving}
                onDone={flow.complete}
                onCancel={flow.cancel}
            />
        );
    }
    if (flow.kind === "bank") {
        return (
            <div className={className}>
                <div className="mt-4 space-y-3">
                    {flow.bankLink !== null ? (
                        <>
                            {flow.bankLink.texted && flow.textTo !== null ? (
                                <Notice tone="success">{s.bankLinkTexted(flow.textTo)}</Notice>
                            ) : (
                                <Notice tone="info">{s.bankLinkHelp}</Notice>
                            )}
                            <CopyField label={s.bankLinkLabel} value={flow.bankLink.url} />
                        </>
                    ) : flow.openBankLink?.verifying === true ? (
                        <Notice tone="info">{flow.openBankLink.note}</Notice>
                    ) : (
                        <>
                            <Notice tone="info">{flow.openBankLink?.note ?? s.bankLinkHelp}</Notice>
                            <div className="flex flex-wrap gap-2">
                                {flow.textTo !== null ? (
                                    <Button
                                        size="sm"
                                        busy={flow.busy}
                                        onPress={() => {
                                            flow.requestBankLink(true);
                                        }}
                                    >
                                        {s.bankLinkText(flow.textTo)}
                                    </Button>
                                ) : null}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    busy={flow.busy}
                                    onPress={() => {
                                        flow.requestBankLink(false);
                                    }}
                                >
                                    {s.bankLinkCreate}
                                </Button>
                            </div>
                        </>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {flow.bankLink !== null || flow.openBankLink !== null ? (
                            <Button variant="quiet" busy={flow.busy} onPress={flow.revokeBankLink}>
                                {s.bankLinkRevoke}
                            </Button>
                        ) : null}
                        <Button variant="quiet" onPress={flow.cancel}>
                            {flow.bankLink !== null ? strings.common.done : strings.common.cancel}
                        </Button>
                    </div>
                    {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
                </div>
            </div>
        );
    }
    return (
        <div className={className}>
            <div className="mt-3 flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    busy={flow.busy}
                    onPress={() => {
                        flow.start("card");
                    }}
                >
                    {flow.busy && flow.kind === "card"
                        ? strings.clients.starting
                        : strings.clients.addCard}
                </Button>
                {allowBank ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onPress={() => {
                            flow.start("bank");
                        }}
                    >
                        {strings.clients.addBankWeb}
                    </Button>
                ) : null}
            </div>
            {allowBank && flow.openBankLink !== null ? (
                <Notice tone="info" className="mt-3">
                    {flow.openBankLink.note}
                </Notice>
            ) : null}
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </div>
    );
}
