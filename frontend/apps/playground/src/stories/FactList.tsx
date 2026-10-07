import type { FactListProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<FactListProps>({
    component: "FactList",
    summary: "Icon-led facts about one visit or order, as on the booking page and the manage link.",
    examples: [
        {
            key: "visit",
            title: "A booked visit",
            props: () => ({
                label: "Your visit",
                facts: [
                    {
                        key: "when",
                        icon: "calendar",
                        title: "Friday, October 9 at 9:00 a.m.",
                        detail: "9:00 a.m. – 10:15 a.m.",
                    },
                    { key: "who", icon: "user", title: "Hannah Wong", detail: "Lead groomer" },
                    {
                        key: "what",
                        icon: "paw",
                        title: "Bella",
                        detail: "Full Groom: Small Dog · 1 h 15 min",
                    },
                    { key: "where", icon: "pin", title: "Birchbark Pet Studio" },
                ],
            }),
        },
        {
            key: "long",
            title: "Long text wraps",
            props: () => ({
                facts: [
                    {
                        key: "what",
                        icon: "paw",
                        title: "Full groom with de-matting, de-shedding and a blueberry facial for double-coated breeds",
                        detail: "Nervous with the dryer; use the quiet setting and take breaks every ten minutes.",
                    },
                ],
            }),
        },
    ],
});
