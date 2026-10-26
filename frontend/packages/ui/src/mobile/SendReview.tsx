import {
    type OutgoingPreview,
    type ReviewChoice,
    type ReviewRequest,
    type SendReviewHostProps,
    type SendReviewProps,
    formatPhone,
    registerReviewHost,
    strings,
    useOutgoingPreview,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useState } from "react";
import { Modal as NativeModal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { MessageBubble } from "./MessageBubble";
import { showOverlay, useAnyModalOpen } from "./layers";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";

const c = theme.colors;

interface Pending {
    request: ReviewRequest;
    resolve: (choice: ReviewChoice | null) => void;
}

/** Mounted once at the app root so review() has somewhere to show what is about to go out. */
export function SendReviewHost({ document }: SendReviewHostProps) {
    const [pending, setPending] = useState<Pending | null>(null);
    const covered = useAnyModalOpen();
    useEffect(
        () =>
            registerReviewHost(
                (request) =>
                    new Promise((resolve) => {
                        setPending({ request, resolve });
                    }),
            ),
        [],
    );
    const resolve = (choice: ReviewChoice | null): void => {
        pending?.resolve(choice);
        setPending(null);
    };
    const sheet =
        pending === null ? null : (
            <SendReview request={pending.request} document={document} onResolve={resolve} />
        );
    useEffect(() => {
        showOverlay(covered ? sheet : null);
    });
    if (sheet === null || covered) return null;
    return (
        <NativeModal
            visible
            transparent
            animationType="fade"
            onRequestClose={() => {
                resolve(null);
            }}
        >
            {sheet}
        </NativeModal>
    );
}

export function SendReview({ request, document, onResolve }: SendReviewProps) {
    const s = strings.ui.review;
    const preview = useOutgoingPreview(request);
    const [showPage, setShowPage] = useState(false);
    const page = request.document !== undefined ? document?.(request.document) : undefined;
    return (
        <View style={styles.backdrop} accessibilityViewIsModal>
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                    onResolve(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
            />
            <ScrollView style={styles.sheet} contentContainerStyle={[styles.stack, styles.pad]}>
                <View>
                    <Text style={styles.title}>{request.title}</Text>
                    {preview.data?.recipient != null ? (
                        <Text style={styles.muted}>{s.to(preview.data.recipient)}</Text>
                    ) : null}
                </View>
                {request.load === undefined ? null : preview.loading ? (
                    <Skeleton variant="line" count={4} label={s.loading} />
                ) : preview.failed ? (
                    <View style={styles.stack}>
                        <Notice tone="danger" banner>
                            {s.loadFailed}
                        </Notice>
                        <Button variant="link" size="sm" onPress={preview.retry}>
                            {s.retry}
                        </Button>
                    </View>
                ) : preview.data !== null ? (
                    <Outgoing preview={preview.data} />
                ) : null}
                {request.message !== undefined ? (
                    <Text style={styles.body}>{request.message}</Text>
                ) : null}
                {page !== undefined ? (
                    <View style={styles.stack}>
                        <Button
                            variant="link"
                            size="sm"
                            icon="receipt"
                            onPress={() => {
                                setShowPage((v) => !v);
                            }}
                        >
                            {showPage ? s.hideDocument : s.showDocument}
                        </Button>
                        {showPage ? page : null}
                    </View>
                ) : null}
                <View style={styles.actions}>
                    <Button
                        full
                        variant={request.destructive === true ? "danger" : "primary"}
                        disabled={preview.loading}
                        onPress={() => {
                            onResolve("confirm");
                        }}
                    >
                        {request.confirmLabel}
                    </Button>
                    {request.alternate !== undefined ? (
                        <Button
                            full
                            variant="outline"
                            onPress={() => {
                                onResolve("alternate");
                            }}
                        >
                            {request.alternate}
                        </Button>
                    ) : null}
                    <Button
                        full
                        variant="quiet"
                        onPress={() => {
                            onResolve(null);
                        }}
                    >
                        {strings.common.cancel}
                    </Button>
                </View>
            </ScrollView>
        </View>
    );
}

function Outgoing({ preview }: { preview: OutgoingPreview }) {
    const s = strings.ui.review;
    if (preview.email === null && preview.text === null)
        return (
            <Notice tone="info" banner>
                {s.nothingSent}
            </Notice>
        );
    return (
        <View style={styles.stack}>
            {preview.email !== null ? (
                <View style={styles.email}>
                    <View style={styles.emailHead}>
                        <Text style={styles.small}>{s.emailTo(preview.email.to)}</Text>
                        <Text style={styles.subject}>{preview.email.subject}</Text>
                    </View>
                    <Text style={[styles.body, styles.emailBody]}>{preview.email.body}</Text>
                </View>
            ) : null}
            {preview.text !== null ? (
                <View style={styles.text}>
                    <Text style={styles.small}>{s.textTo(formatPhone(preview.text.to))}</Text>
                    <MessageBubble direction="out" width="full" body={preview.text.body} />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: c.scrim,
        justifyContent: "flex-end",
    },
    sheet: {
        flexGrow: 0,
        maxHeight: "88%",
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
    },
    pad: { padding: 22, paddingBottom: 36 },
    stack: { gap: 12 },
    title: { fontFamily: theme.fonts.ui, fontSize: 18, fontWeight: "700", color: c.ink },
    muted: { marginTop: 4, fontFamily: theme.fonts.ui, fontSize: 14, color: c.muted },
    small: { fontFamily: theme.fonts.ui, fontSize: 12, color: c.muted },
    body: { fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, color: c.inkSoft },
    subject: {
        marginTop: 2,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "600",
        color: c.ink,
    },
    email: { borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: "hidden" },
    emailHead: {
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.head,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    emailBody: { paddingHorizontal: 14, paddingVertical: 12 },
    text: { gap: 8, borderRadius: 10, backgroundColor: c.bg, padding: 14 },
    actions: { gap: 8, marginTop: 4 },
});
