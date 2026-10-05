import { type AddPaymentMethod, strings } from "@clientbridge/app-core/public";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Notice } from "./Notice";

export function PaymentMethodForm({
    flow,
    allowBank,
}: {
    flow: AddPaymentMethod;
    allowBank: boolean;
}) {
    if (flow.intent !== null && flow.kind !== null) {
        const noun =
            flow.kind === "bank" ? strings.clients.bankAccountNoun : strings.clients.cardNoun;
        return (
            <CardForm
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
        <>
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
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </>
    );
}
