import { story } from "../story";

// Logo and Lockup keep per-platform props (a class on web, colours on mobile), so the kit draws each.
export default [
    story<Record<string, never>>({
        component: "Logo",
        summary: "The Clientbridge monogram.",
        render: (k) => k.logo(),
        examples: [{ key: "logo", title: "Mark", props: () => ({}) }],
    }),
    story<Record<string, never>>({
        component: "Lockup",
        summary: "The monogram beside the wordmark, sized from the wordmark's font size.",
        render: (k) => k.lockup(),
        examples: [{ key: "lockup", title: "Lockup", props: () => ({}) }],
    }),
];
