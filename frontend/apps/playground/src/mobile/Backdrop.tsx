import { SHADOW, tintHex } from "@clientbridge/tokens";
import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";

import photo from "../backdrop-photo.jpg";
import type { Backdrop as Kind } from "../story";
import { theme } from "./nativeTheme";

const c = theme.colors;

export function Backdrop({
    backdrop,
    children,
}: {
    backdrop: Kind | undefined;
    children: ReactNode;
}) {
    if (backdrop === undefined) return <>{children}</>;
    return (
        <View
            style={[
                styles.box,
                { backgroundColor: backdrop === "brand" ? c.accentStrong : c.side },
            ]}
        >
            {backdrop === "photo" ? (
                <>
                    <Image
                        source={{ uri: photo }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                    />
                    <View style={[StyleSheet.absoluteFill, styles.scrim]} />
                </>
            ) : null}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { padding: 16, borderRadius: theme.radius, overflow: "hidden" },
    scrim: { backgroundColor: tintHex(SHADOW, 55) },
});
