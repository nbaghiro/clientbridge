import { ICON_SPECS, type IconName, type IconProps } from "@clientbridge/app-core";

import { story } from "../story";

const NAMES = Object.keys(ICON_SPECS) as IconName[];

type IconStory = IconProps & { gallery?: boolean; sizes?: boolean };

const SIZES = [12, 16, 20, 24, 32, 48];

export default [
    story<IconStory>({
        component: "Icon",
        summary:
            "A glyph from the shared icon geometry in app-core, drawn as SVG on both platforms.",
        controls: {
            name: { type: "select", options: NAMES },
            size: { type: "number", min: 12, max: 48, step: 2 },
            label: { type: "text" },
            color: { type: "text" },
        },
        render: (k, { gallery, sizes, ...props }) =>
            sizes === true ? (
                <k.Stack row>
                    {SIZES.map((size) => (
                        <k.Icon key={size} name={props.name} size={size} />
                    ))}
                </k.Stack>
            ) : gallery === true ? (
                <k.Stack row>
                    {NAMES.map((name) => (
                        <k.Icon key={name} name={name} label={name} size={22} />
                    ))}
                </k.Stack>
            ) : (
                <k.Icon {...props} />
            ),
        examples: [
            { key: "default", title: "Default", props: () => ({ name: "calendar" }) },
            { key: "large", title: "Large", props: () => ({ name: "paw", size: 32 }) },
            {
                key: "sizes",
                title: "Every size from 12 to 48",
                props: () => ({ name: "bell", sizes: true }),
            },
            {
                key: "labelled",
                title: "Labelled for screen readers",
                props: () => ({ name: "alert", label: "Overdue" }),
            },
            {
                key: "gallery",
                title: "Every glyph",
                props: () => ({ name: "today", gallery: true }),
            },
        ],
    }),
    story<{ size?: number | undefined }>({
        component: "GoogleIcon",
        summary: "Google's four-colour mark for the sign-in button.",
        controls: { size: { type: "number", min: 12, max: 48, step: 2 } },
        examples: [
            { key: "google", title: "Default", props: () => ({}) },
            { key: "google-large", title: "Large", props: () => ({ size: 32 }) },
        ],
    }),
];
