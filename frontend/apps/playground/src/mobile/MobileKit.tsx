import { Avatar, Badge, Button, Icon, Lockup, Logo, Money, confirm } from "@clientbridge/ui";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { Kit } from "../kit";
import { theme } from "./nativeTheme";

const c = theme.colors;

function KitText({
    children,
    tone = "ink",
}: {
    children: ReactNode;
    tone?: "ink" | "muted" | undefined;
}) {
    return (
        <Text style={{ color: tone === "ink" ? c.ink : c.muted, fontSize: 14 }}>{children}</Text>
    );
}

function KitStack({ children, row = false }: { children: ReactNode; row?: boolean | undefined }) {
    return (
        <View style={{ flexDirection: row ? "row" : "column", gap: 8, flexWrap: "wrap" }}>
            {children}
        </View>
    );
}

export const mobileKit: Kit = {
    platform: "mobile",
    Button,
    Badge,
    Avatar,
    Icon,
    Money,
    Text: KitText,
    Stack: KitStack,
    logo: () => <Logo height={32} color={c.accent} />,
    lockup: () => <Lockup fontSize={20} markColor={c.accent} textColor={c.ink} />,
    confirm,
};
