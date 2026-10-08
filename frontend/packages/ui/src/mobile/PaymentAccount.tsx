import { type PaymentAccountProps, strings } from "@clientbridge/app-core/public";
import { theme } from "@clientbridge/tokens/native";
import {
    ConnectAccountOnboarding,
    ConnectComponentsProvider,
    ConnectPayments,
    ConnectPayouts,
    loadConnectAndInitialize,
} from "@stripe/stripe-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { Modal } from "./Modal";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";
import type { NativeProps } from "./props";
import { stripePublishableKey } from "./stripe";

const s = strings.paymentAccount;
const c = theme.colors;

export function PaymentAccount(props: NativeProps<PaymentAccountProps>) {
    return <AccountSession key={props.scope} {...props} />;
}

function AccountSession({
    component,
    fetchClientSecret,
    onClose,
    preview = false,
    style,
}: NativeProps<PaymentAccountProps>) {
    const [instance, setInstance] = useState<ReturnType<typeof loadConnectAndInitialize> | null>(
        null,
    );
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const key = stripePublishableKey();
    useEffect(() => {
        if (key === "" || preview) return;
        let active = true;
        const isActive = (): boolean => active;
        const next = loadConnectAndInitialize({
            publishableKey: key,
            fetchClientSecret: async () => {
                if (!isActive()) throw new Error(s.expired);
                try {
                    const secret = await fetchClientSecret();
                    if (!isActive()) throw new Error(s.expired);
                    return secret;
                } catch (error) {
                    if (isActive()) setFailed(true);
                    throw error;
                }
            },
            appearance: {
                variables: {
                    colorPrimary: c.accent,
                    colorText: c.ink,
                    colorBackground: c.surface,
                    colorDanger: c.danFg,
                },
            },
        });
        setInstance(next);
        return () => {
            active = false;
        };
    }, [key, preview, fetchClientSecret, attempt]);
    const fail = (): void => {
        setFailed(true);
    };
    const retry = (): void => {
        setFailed(false);
        setInstance(null);
        setAttempt((value) => value + 1);
    };
    const onboarding = component === "onboarding" || component === "account";
    if (instance !== null && onboarding && !failed) {
        return (
            <ConnectComponentsProvider connectInstance={instance}>
                <ConnectAccountOnboarding
                    title={component === "account" ? s.reviewSetup : s[component]}
                    onExit={onClose}
                    onLoadError={fail}
                />
            </ConnectComponentsProvider>
        );
    }
    return (
        <Modal size="xl" onClose={onClose} framed={false}>
            <View style={[styles.screen, style]}>
                <View style={styles.header}>
                    <Text style={styles.title}>{s[component]}</Text>
                    <Button variant="outline" onPress={onClose}>
                        {s.close}
                    </Button>
                </View>
                {preview || key === "" ? (
                    <View style={styles.content}>
                        <Notice tone="info">{preview ? s.preview : s.unavailable}</Notice>
                    </View>
                ) : failed ? (
                    <View style={styles.content}>
                        <Notice tone="danger">{s.error}</Notice>
                        <Button variant="outline" onPress={retry}>
                            {s.retry}
                        </Button>
                    </View>
                ) : instance === null ? (
                    <View style={styles.content}>
                        <Skeleton variant="line" count={3} label={s.loading} />
                    </View>
                ) : (
                    <ConnectComponentsProvider connectInstance={instance}>
                        {component === "payments" ? (
                            <ConnectPayments style={styles.fill} onLoadError={fail} />
                        ) : (
                            <ConnectPayouts style={styles.fill} onLoadError={fail} />
                        )}
                    </ConnectComponentsProvider>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface },
    fill: { flex: 1 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: 16,
        borderBottomWidth: 1,
        borderColor: c.border,
    },
    title: { flex: 1, fontSize: 18, fontWeight: "700", color: c.ink },
    content: { padding: 16, gap: 12 },
});
