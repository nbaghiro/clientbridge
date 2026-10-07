import {
    type EntitlementSaleForm,
    type WalletKind,
    formatMoney,
    strings,
    useEntitlementSaleForm,
} from "@clientbridge/app-core";
import { StyleSheet, View } from "react-native";
import { Button, ChargeSheet, Choice, DocTotals, Field, Notice, TextField } from "@clientbridge/ui";

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
    if (form.sold !== null) {
        return (
            <View style={styles.gap}>
                <Notice tone="success" banner>
                    {`${w.doneTitle}. ${form.sold}`}
                </Notice>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.close}
                </Button>
            </View>
        );
    }
    return (
        <ChargeSheet
            title={w.sellTitle}
            checkout={form.checkout}
            methods={form.methods}
            amountLabel={formatMoney(form.totalCents)}
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
        <View style={styles.gap}>
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
                <>
                    <TextField
                        label={w.giftAmount}
                        type="number"
                        prefix="$"
                        value={form.amount}
                        onChange={form.setAmount}
                    />
                    <Choice
                        label={w.giftAmount}
                        options={form.presets}
                        value={form.amount}
                        onChange={form.setAmount}
                    />
                    <TextField
                        label={w.recipient}
                        hint={w.recipientHint}
                        optional
                        value={form.recipient}
                        onChange={form.setRecipient}
                    />
                </>
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
                <Field label={w.client}>
                    <Choice
                        options={form.clientOptions}
                        value={form.clientId}
                        onChange={form.setClientId}
                    />
                </Field>
            ) : null}
            {form.needsCard ? <Notice tone="info">{w.membershipNeedsCard}</Notice> : null}
            <DocTotals lines={form.lines} density="compact" />
        </View>
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

const styles = StyleSheet.create({ gap: { gap: 12 } });
