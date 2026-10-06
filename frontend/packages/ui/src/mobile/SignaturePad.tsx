import {
    type SignaturePadProps,
    type SignatureStrokes,
    strings,
    useControllable,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { NativeProps } from "./props";

const c = theme.colors;

const path = (stroke: readonly (readonly [number, number])[], w: number, h: number): string =>
    stroke
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${(x * w).toFixed(1)} ${(y * h).toFixed(1)}`)
        .join(" ");

export function SignaturePad({
    strokes: strokesProp,
    defaultStrokes = [],
    onChange,
    editable = onChange !== undefined,
    label,
    placeholder,
    clearLabel = strings.ui.clear,
    height = 140,
    style,
}: NativeProps<SignaturePadProps>) {
    const [strokes, setStrokes] = useControllable(strokesProp, defaultStrokes, onChange);
    const [width, setWidth] = useState(0);
    const [live, setLive] = useState<[number, number][] | null>(null);
    const state = useRef({
        width: 0,
        strokes,
        live: null as [number, number][] | null,
        setStrokes,
        editable,
    });
    state.current = { width, strokes, live, setStrokes, editable };

    const at = (x: number, y: number): [number, number] => {
        const w = state.current.width || 1;
        return [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / height))];
    };

    const responder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => state.current.editable,
            onMoveShouldSetPanResponder: () => state.current.editable,
            onPanResponderGrant: (e) => {
                const next: [number, number][] = [
                    at(e.nativeEvent.locationX, e.nativeEvent.locationY),
                ];
                state.current.live = next;
                setLive(next);
            },
            onPanResponderMove: (e) => {
                const next = [
                    ...(state.current.live ?? []),
                    at(e.nativeEvent.locationX, e.nativeEvent.locationY),
                ];
                state.current.live = next;
                setLive(next);
            },
            onPanResponderRelease: () => {
                const done = state.current.live;
                if (done !== null && done.length > 1)
                    state.current.setStrokes([...state.current.strokes, done] as SignatureStrokes);
                state.current.live = null;
                setLive(null);
            },
        }),
    ).current;

    const shown = live === null ? strokes : [...strokes, live];

    return (
        <View
            style={[editable && styles.pad, { height }, style]}
            onLayout={(e) => {
                setWidth(e.nativeEvent.layout.width);
            }}
            accessible={!editable}
            accessibilityRole="image"
            accessibilityLabel={label}
            {...responder.panHandlers}
        >
            {width > 0 ? (
                <Svg
                    width={width}
                    height={height}
                    style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}
                >
                    {shown.map((s, i) => (
                        <Path
                            key={i}
                            d={path(s, width, height)}
                            fill="none"
                            stroke={c.ink}
                            strokeWidth={2.2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    ))}
                </Svg>
            ) : null}
            {editable ? <View style={styles.line} /> : null}
            {editable && shown.length === 0 && placeholder !== undefined ? (
                <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>{placeholder}</Text>
                </View>
            ) : null}
            {editable && strokes.length > 0 ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                        setStrokes([]);
                    }}
                    style={styles.clear}
                    hitSlop={8}
                >
                    <Text style={styles.clearText}>{clearLabel}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    pad: {
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
        overflow: "hidden",
    },
    line: {
        pointerEvents: "none",
        position: "absolute",
        left: 20,
        right: 20,
        bottom: 28,
        borderBottomWidth: 1,
        borderColor: c.border,
        borderStyle: "dashed",
    },
    placeholder: {
        pointerEvents: "none",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    placeholderText: { color: c.muted, fontSize: 14 },
    clear: { position: "absolute", top: 8, right: 10 },
    clearText: { color: c.accent, fontSize: 13, fontWeight: "600" },
});
