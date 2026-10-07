import { type TagInputProps, strings, useControllable } from "@clientbridge/app-core/public";
import { useId, useState } from "react";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function TagInput({
    label,
    tags: tagsProp,
    defaultTags = [],
    onAdd,
    onRemove,
    suggestions = [],
    placeholder,
    removeLabel = strings.ui.removeTag,
    createLabel = strings.ui.createTag,
    className,
}: WebProps<TagInputProps>) {
    const id = useId();
    const [tags, setTags] = useControllable(tagsProp, defaultTags);
    const [q, setQ] = useState("");
    const remove = (tag: string): void => {
        setTags(tags.filter((t) => t !== tag));
        onRemove?.(tag);
    };
    const text = q.trim().toLowerCase();
    const open = suggestions.filter((s) => !tags.includes(s.tag));
    const matches =
        text === "" ? open.slice(0, 6) : open.filter((s) => s.tag.includes(text)).slice(0, 6);
    const exact = open.some((s) => s.tag === text) || tags.includes(text);
    const add = (tag: string): void => {
        setTags([...tags, tag]);
        onAdd?.(tag);
        setQ("");
    };

    return (
        <div className={cx("flex flex-col gap-1.5", className)}>
            <label htmlFor={id} className="text-sm font-medium text-ink-soft">
                {label}
            </label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1.5 focus-within:border-accent">
                {tags.map((t) => (
                    <span
                        key={t}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-weak py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent-strong"
                    >
                        <span className="truncate" title={t}>
                            {t}
                        </span>
                        <button
                            type="button"
                            aria-label={removeLabel(t)}
                            onClick={() => {
                                remove(t);
                            }}
                            className="shrink-0 rounded-full p-0.5 hover:bg-accent-line hover:text-accent-strong"
                        >
                            <Icon name="x" size={12} />
                        </button>
                    </span>
                ))}
                <input
                    id={id}
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && text !== "") {
                            e.preventDefault();
                            add(text);
                        }
                        if (e.key === "Backspace" && q === "" && tags.length > 0)
                            remove(tags[tags.length - 1] ?? "");
                    }}
                    placeholder={tags.length === 0 ? placeholder : ""}
                    className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-hidden placeholder:text-muted"
                />
            </div>
            {matches.length > 0 || (text !== "" && !exact) ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
                    {matches.map((s) => (
                        <button
                            key={s.tag}
                            type="button"
                            onClick={() => {
                                add(s.tag);
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-soft hover:bg-bg hover:text-ink"
                        >
                            <Icon name="plus" size={12} />
                            {s.tag}
                            <span className="text-muted">{s.count}</span>
                        </button>
                    ))}
                    {text !== "" && !exact ? (
                        <button
                            type="button"
                            onClick={() => {
                                add(text);
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-accent-line px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent-weak hover:text-accent-strong"
                        >
                            <Icon name="plus" size={12} />
                            {createLabel(text)}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
