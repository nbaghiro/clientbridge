import { storiesOf } from "./Render";
import type { StoryEntry } from "./story";

const files = import.meta.glob<{ default: StoryEntry | readonly StoryEntry[] }>("./stories/*.tsx", {
    eager: true,
});

// One page per file in packages/ui: the file stem names the page, its stories are the sections.
export const PAGES: readonly { name: string; stories: readonly StoryEntry[] }[] = Object.entries(
    files,
)
    .map(([path, mod]) => ({
        name: path.replace("./stories/", "").replace(".tsx", ""),
        stories: storiesOf(mod),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

export function findPage(name: string): (typeof PAGES)[number] | undefined {
    return PAGES.find((p) => p.name === name);
}
