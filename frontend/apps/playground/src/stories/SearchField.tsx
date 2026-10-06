import type { SearchFieldProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<SearchFieldProps>({
    component: "SearchField",
    summary:
        "A search box with a clear button, result-list keys, a trailing slot and a large size.",
    controls: { placeholder: { type: "text" }, size: { type: "select", options: ["md", "lg"] } },
    examples: [
        { key: "default", title: "Empty", props: () => ({ placeholder: "Search clients…" }) },
        {
            key: "typed",
            title: "With a query",
            props: () => ({ placeholder: "Search clients…", defaultValue: "Tremblay" }),
        },
        {
            key: "large",
            title: "Large, for a command palette",
            props: () => ({
                placeholder: "Search clients, pets, invoices…",
                size: "lg",
                onKey: noop,
            }),
        },
        {
            key: "trailing",
            title: "With a trailing action",
            props: (k) => ({
                placeholder: "Search services…",
                trailing: (
                    <k.Button variant="link" size="sm" onPress={noop}>
                        Cancel
                    </k.Button>
                ),
            }),
        },
    ],
});
