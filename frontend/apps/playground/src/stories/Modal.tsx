import type { ModalProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const LONG = Array.from(
    { length: 24 },
    (_, i) => `Line ${String(i + 1)}: full groom, bath and tidy, nail trim and ear clean.`,
);

export default story<ModalProps>({
    component: "Modal",
    summary: "A dialog on web and a bottom sheet on mobile; xl is the large panel.",
    controls: {
        size: { type: "select", options: ["sm", "md", "lg", "xl"] },
        framed: { type: "boolean" },
        flow: { type: "boolean" },
    },
    examples: [
        {
            key: "default",
            title: "Dialog",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                children: (
                    <k.Stack>
                        <k.Text>Cancel Diego's 2:30 p.m. groom?</k.Text>
                        <k.Button variant="danger">Cancel visit</k.Button>
                    </k.Stack>
                ),
            }),
        },
        {
            key: "small",
            title: "Small",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                size: "sm",
                children: <k.Text>Mark invoice 1148 as sent?</k.Text>,
            }),
        },
        {
            key: "wide",
            title: "Large",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                size: "lg",
                children: (
                    <k.Stack>
                        <k.Text>Move Biscuit's groom</k.Text>
                        <k.Text tone="muted">Pick a new time on Thursday or Friday.</k.Text>
                    </k.Stack>
                ),
            }),
        },
        {
            key: "large",
            title: "Large panel",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                size: "xl",
                children: <k.Text>Edit invoice 1148</k.Text>,
            }),
        },
        {
            key: "scroll",
            title: "Long content that scrolls",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                size: "md",
                children: (
                    <k.Stack>
                        {LONG.map((line) => (
                            <k.Text key={line}>{line}</k.Text>
                        ))}
                    </k.Stack>
                ),
            }),
        },
        {
            key: "unframed",
            title: "Unframed",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                framed: false,
                children: <k.Text>The children draw their own surface here.</k.Text>,
            }),
        },
    ],
});
