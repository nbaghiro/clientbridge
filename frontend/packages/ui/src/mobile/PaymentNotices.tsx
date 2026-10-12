import { type PaymentNoticesProps, strings } from "@clientbridge/app-core/public";
import { StyleSheet, View } from "react-native";

import { Button } from "./Button";
import { Notice } from "./Notice";
import type { NativeProps } from "./props";

const s = strings.paymentAccount;

// The native SDK lacks the banner and Stripe rules out Connect.js in a WebView, so link to web.
export function PaymentNotices({
    attention,
    onReview,
    reviewing = false,
    preview = false,
    style,
}: NativeProps<PaymentNoticesProps>) {
    if (!attention && !preview) return null;
    return (
        <View accessibilityLabel={s.notices} style={[styles.box, style]}>
            <Notice tone={preview ? "info" : "danger"} banner>
                {preview ? s.preview : s.noticesAttention}
            </Notice>
            <Button variant="outline" icon="external" busy={reviewing} onPress={onReview}>
                {s.reviewNotices}
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
});
