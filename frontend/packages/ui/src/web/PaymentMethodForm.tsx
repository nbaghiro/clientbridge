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
                        busy={flow.busy}
                        onPress={() => {
                            flow.start("bank");
                        }}
                    >
                        {flow.busy && flow.kind === "bank"
                            ? strings.clients.starting
                            : strings.clients.addBankWeb}
                    </Button>
                ) : null}
            </div>
            {flow.bankLink !== null ? (
                <div className="mt-4 space-y-3">
                    <Notice tone="info">{strings.checkout.bankLinkHelp}</Notice>
                    <CopyField label={strings.checkout.bankLinkLabel} value={flow.bankLink.url} />
                    <Button variant="quiet" busy={flow.busy} onPress={flow.revokeBankLink}>
                        {strings.checkout.bankLinkRevoke}
                    </Button>
                </div>
            ) : null}
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </div>
    );
}
