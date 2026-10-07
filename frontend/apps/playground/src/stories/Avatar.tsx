import type { AvatarProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<AvatarProps>({
    component: "Avatar",
    summary: "A person's or pet's initials on a tint of the accent or their own colour.",
    controls: {
        name: { type: "text" },
        size: { type: "select", options: ["sm", "md", "lg", "xl"] },
    },
    examples: [
        { key: "default", title: "Default", props: () => ({ name: "Hannah Lee" }) },
        { key: "small", title: "Small", props: () => ({ name: "Diego Ruiz", size: "sm" }) },
        { key: "large", title: "Large", props: () => ({ name: "Amélie Tremblay", size: "lg" }) },
        {
            key: "extra-large",
            title: "Extra large",
            props: () => ({ name: "Noah Schmidt", size: "xl" }),
        },
        {
            key: "colour",
            title: "Staff colour",
            props: () => ({ name: "Priya Shah", color: "#2E7A5A", size: "lg" }),
        },
        {
            key: "colour-small",
            title: "Pet colour, small",
            props: () => ({ name: "Biscuit", color: "#B4532A", size: "sm" }),
        },
        { key: "number", title: "Phone number", props: () => ({ name: "+1 250 555 0101" }) },
        { key: "single", title: "One name", props: () => ({ name: "Juniper" }) },
        {
            key: "long",
            title: "Long name",
            props: () => ({ name: "Bartholomew Featherstonehaugh-Montgomery", size: "lg" }),
        },
        { key: "arabic", title: "Arabic name", props: () => ({ name: "ليلى حداد", size: "lg" }) },
        { key: "hebrew", title: "Hebrew name", props: () => ({ name: "נועה כהן", size: "lg" }) },
        { key: "blank", title: "No name", props: () => ({ name: "" }) },
    ],
});
