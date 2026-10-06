import type { ModalProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ModalProps>({
    component: "Modal",
    summary: "A dialog on web and a bottom sheet on mobile; xl is the large panel.",
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
            key: "large",
            title: "Large panel",
            overlay: true,
            props: (k) => ({
                onClose: noop,
                size: "xl",
                children: <k.Text>Edit invoice 1148</k.Text>,
            }),
        },
    ],
});
