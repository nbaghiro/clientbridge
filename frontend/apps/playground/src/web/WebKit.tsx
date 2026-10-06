import { Avatar, Badge, Button, Icon, Lockup, Logo, Money, confirm } from "@clientbridge/ui";
import type { ReactNode } from "react";

import type { Kit } from "../kit";

function KitText({
    children,
    tone = "ink",
}: {
    children: ReactNode;
    tone?: "ink" | "muted" | undefined;
}) {
    return (
        <span className={`text-sm ${tone === "ink" ? "text-ink" : "text-muted"}`}>{children}</span>
    );
}

function KitStack({ children, row = false }: { children: ReactNode; row?: boolean | undefined }) {
    return (
        <div
            className={`flex flex-wrap gap-2 ${row ? "flex-row items-center" : "flex-col items-start"}`}
        >
            {children}
        </div>
    );
}

export const webKit: Kit = {
    platform: "web",
    Button,
    Badge,
    Avatar,
    Icon,
    Money,
    Text: KitText,
    Stack: KitStack,
    logo: () => <Logo className="h-8 w-auto text-accent" />,
    lockup: () => <Lockup className="text-lg text-ink" />,
    confirm,
};
