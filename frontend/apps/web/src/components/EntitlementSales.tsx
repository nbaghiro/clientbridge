import {
    type EntitlementSaleForm,
    type WalletKind,
    formatMoney,
    strings,
    useEntitlementSaleForm,
    BUSINESS_CURRENCY,
    currencyAffix,
} from "@clientbridge/app-core";
import {
    Button,
    ChargeSheet,
    Choice,
    DocTotals,
    Field,
    Icon,
    Notice,
    SearchSelect,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const w = strings.entitlements;

/** Sell a package, membership or gift card: what, for whom, how they pay, and the total with tax. */
export function SellEntitlement({
    kind,
    clientId = null,
    onClose,
}: {
    kind?: WalletKind;
    clientId?: string | null;
    onClose: () => void;
}) {
    const form = useEntitlementSaleForm(api, { kind, clientId });
    if (form.sold !== null) return <Sold form={form} onClose={onClose} />;
    return (
        <ChargeSheet
            title={w.sellTitle}
            checkout={form.checkout}
            methods={form.methods}
            amountLabel={formatMoney(form.totalCents, BUSINESS_CURRENCY)}
            submitLabel={form.submitLabel}
            busyLabel={form.busyLabel}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <SaleFields form={form} pickKind={kind === undefined} pickClient={clientId === null} />
        </ChargeSheet>
    );
}

function SaleFields({
    form,
    pickKind,
    pickClient,
}: {
    form: EntitlementSaleForm;
    pickKind: boolean;
    pickClient: boolean;
}) {
    return (
        <div className="space-y-4">
            {pickKind ? (
                <Field label={w.chooseKind}>
                    <Choice
                        layout="segmented"
                        label={w.chooseKind}
                        options={form.kinds}
                        value={form.kind}
                        onChange={form.setKind}
                    />
                </Field>
            ) : null}
            {form.kind === "gift_card" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <TextField
                            label={w.giftAmount}
                            type="number"
                            {...currencyAffix(BUSINESS_CURRENCY)}
                            value={form.amount}
                            onChange={form.setAmount}
                        />
                        <Choice
                            label={w.giftAmount}
                            options={form.presets}
                            value={form.amount}
                            onChange={form.setAmount}
                        />
                    </div>
                    <TextField
                        label={w.recipient}
                        hint={w.recipientHint}
                        optional
                        value={form.recipient}
                        onChange={form.setRecipient}
                    />
                </div>
            ) : form.noItems !== null ? (
                <Notice tone="info">{form.noItems}</Notice>
            ) : (
                <Field label={w.chooseItem}>
                    <Choice
                        layout="cards"
                        label={w.chooseItem}
                        options={form.items}
                        value={form.itemId}
                        onChange={form.setItemId}
                    />
                </Field>
            )}
            {pickClient ? (
                <SearchSelect
                    label={w.client}
                    value={form.clientId}
                    placeholder={w.chooseClient}
                    options={form.clientOptions}
                    onChange={form.setClientId}
                />
            ) : null}
            {form.subject !== null ? (
                <Field label={form.subject.label} hint={form.subject.hint}>
                    <Choice
                        label={form.subject.label}
                        options={form.subject.options}
                        value={form.subject.value}
                        onChange={form.subject.pick}
                    />
                </Field>
            ) : null}
            {form.needsCard ? <Notice tone="info">{w.membershipNeedsCard}</Notice> : null}
            <div className="rounded-md border border-line bg-bg px-4 py-3">
                <DocTotals currency={BUSINESS_CURRENCY} lines={form.lines} density="compact" />
            </div>
        </div>
    );
}

function Sold({ form, onClose }: { form: EntitlementSaleForm; onClose: () => void }) {
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-md bg-ok-bg px-4 py-3 text-ok-fg">
                <Icon name="checkCircle" size={20} />
                <div className="text-sm">
                    <p className="font-semibold">{w.doneTitle}</p>
                    <p className="mt-0.5">{form.sold}</p>
                </div>
            </div>
            <div className="flex justify-end">
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.close}
                </Button>
            </div>
        </div>
    );
}

export function SellPackage({
    clientId,
    onClose,
}: {
    clientId: string | null;
    onClose: () => void;
}) {
    return <SellEntitlement kind="package" clientId={clientId} onClose={onClose} />;
}

export function StartSubscription({
    clientId,
    onClose,
}: {
    clientId: string | null;
    onClose: () => void;
}) {
    return <SellEntitlement kind="membership" clientId={clientId} onClose={onClose} />;
}
