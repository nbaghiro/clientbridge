import { type AddPaymentMethod, strings } from "@clientbridge/app-core/public";

import { CardForm } from "./CardForm";
import { outlineButton } from "./styles";

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
                <button
                    type="button"
                    disabled={flow.busy}
                    onClick={() => {
                        flow.start("card");
                    }}
                    className={outlineButton}
                >
                    {flow.busy && flow.kind === "card"
                        ? strings.clients.starting
                        : strings.clients.addCard}
                </button>
                {allowBank ? (
                    <button
                        type="button"
                        disabled={flow.busy}
                        onClick={() => {
                            flow.start("bank");
                        }}
                        className={outlineButton}
                    >
                        {flow.busy && flow.kind === "bank"
                            ? strings.clients.starting
                            : strings.clients.addBankWeb}
                    </button>
                ) : null}
            </div>
            {flow.error !== null ? <p className="mt-2 text-sm text-danger">{flow.error}</p> : null}
        </>
    );
}
