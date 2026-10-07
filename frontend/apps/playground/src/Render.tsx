import { type ComponentType, type ReactNode, useState } from "react";

import type { Kit } from "./kit";
import type { ControlValue, StoryEntry } from "./story";

type Library = Readonly<Record<string, unknown>>;

export function Rendered({
    entry,
    example,
    kit,
    ui,
    values,
}: {
    entry: StoryEntry;
    example: StoryEntry["examples"][number];
    kit: Kit;
    ui: Library;
    values?: Readonly<Record<string, ControlValue>> | undefined;
}) {
    const [open, setOpen] = useState(false);
    const base: Record<string, unknown> = { ...example.props(kit), ...values };
    const binding = example.state;
    const seed = binding ? base[binding.value] : undefined;
    const [held, setHeld] = useState<unknown>(seed);
    // A live control that edits the bound prop resets the held value.
    const seedKey: string | undefined = JSON.stringify(seed);
    const [heldFrom, setHeldFrom] = useState(seedKey);
    if (heldFrom !== seedKey) {
        setHeldFrom(seedKey);
        setHeld(seed);
    }
    const props = binding
        ? {
              ...base,
              [binding.value]: held,
              [binding.onChange]: (next: unknown) => {
                  setHeld((h: unknown) => (binding.reduce ? binding.reduce(h, next) : next));
              },
          }
        : base;
    const draw = (extra: object): ReactNode => {
        if (entry.render) return entry.render(kit, { ...props, ...extra });
        const Component = ui[entry.component] as ComponentType<object> | undefined;
        return Component ? <Component {...props} {...extra} /> : null;
    };
    if (example.overlay !== true) return <>{draw({})}</>;
    return (
        <kit.Stack>
            <kit.Button
                variant="outline"
                size="sm"
                onPress={() => {
                    setOpen(true);
                }}
            >
                {`Open ${example.title.toLowerCase()}`}
            </kit.Button>
            {draw({
                open,
                onClose: () => {
                    setOpen(false);
                },
            })}
        </kit.Stack>
    );
}

export function storiesOf(mod: {
    default: StoryEntry | readonly StoryEntry[];
}): readonly StoryEntry[] {
    const d = mod.default;
    return isList(d) ? d : [d];
}

function isList(d: StoryEntry | readonly StoryEntry[]): d is readonly StoryEntry[] {
    return Array.isArray(d);
}
