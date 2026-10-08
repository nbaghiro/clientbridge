import type { ReactNode } from "react";
import { strings } from "@clientbridge/app-core";
import { Text, View } from "react-native";

import { theme } from "./nativeTheme";

// Stripe's React Native SDK has no web build; the preview draws a placeholder card field instead.
export function StripeProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

export function CardField() {
    return (
        <View
            style={{
                height: 46,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius,
                justifyContent: "center",
                paddingHorizontal: 12,
            }}
        >
            <Text style={{ color: theme.colors.muted }}>4242 4242 4242 4242 12/30 123</Text>
        </View>
    );
}

const done = { error: undefined };

export const useConfirmPayment = () => ({
    confirmPayment: () => Promise.resolve(done),
    loading: false,
});

export const useConfirmSetupIntent = () => ({
    confirmSetupIntent: () => Promise.resolve(done),
    loading: false,
});

export function loadConnectAndInitialize() {
    return { update: () => undefined };
}

export function ConnectComponentsProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

export function ConnectAccountOnboarding() {
    return <Text>{strings.paymentAccount.preview}</Text>;
}

export function ConnectPayments() {
    return <ConnectAccountOnboarding />;
}

export function ConnectPayouts() {
    return <ConnectAccountOnboarding />;
}
