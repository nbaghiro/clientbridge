import {
    Avatar,
    Badge,
    Button,
    Checkbox,
    Icon,
    Lockup,
    Logo,
    Money,
    confirm,
} from "@clientbridge/ui";
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

function KitStack({
    children,
    row = false,
    end = false,
}: {
    children: ReactNode;
    row?: boolean | undefined;
    end?: boolean | undefined;
}) {
    const cross = end ? "items-end" : row ? "items-center" : "items-start";
    return (
        <div className={`flex flex-wrap gap-2 ${row ? "flex-row" : "flex-col"} ${cross}`}>
            {children}
        </div>
    );
}

export const webKit: Kit = {
    platform: "web",
    Button,
    Badge,
    Checkbox,
    Avatar,
    Icon,
    Money,
    Text: KitText,
    Stack: KitStack,
    logo: () => <Logo className="h-8 w-auto text-accent" />,
    lockup: () => <Lockup className="text-lg text-ink" />,
    confirm,
};
