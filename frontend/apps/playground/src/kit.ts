import type {
    AvatarProps,
    BadgeProps,
    ButtonProps,
    CheckboxProps,
    ConfirmOptions,
    IconProps,
    MoneyProps,
} from "@clientbridge/app-core";
import type { ComponentType, ReactNode } from "react";

// The building blocks a story may use for slot content, drawn by whichever platform renders it.
export interface Kit {
    platform: "web" | "mobile";
    Button: ComponentType<ButtonProps>;
    Badge: ComponentType<BadgeProps>;
    Checkbox: ComponentType<CheckboxProps>;
    Avatar: ComponentType<AvatarProps>;
    Icon: ComponentType<IconProps>;
    Money: ComponentType<MoneyProps>;
    Text: ComponentType<{ children: ReactNode; tone?: "ink" | "muted" | undefined }>;
    Stack: ComponentType<{
        children: ReactNode;
        row?: boolean | undefined;
        end?: boolean | undefined;
    }>;
    // Logo and Lockup keep per-platform props, so each platform draws its own sample.
    logo: () => ReactNode;
    lockup: () => ReactNode;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}
