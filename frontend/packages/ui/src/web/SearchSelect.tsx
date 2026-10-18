import {
    type SearchSelectProps,
    type SelectOption,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Labelled, fieldClass } from "./Field";
import { Icon } from "./Icon";
import { usePopover } from "./popover";
import { type WebProps, type WithRef, cx, mergeRefs } from "./props";
import { OptionLead, OptionList, matches } from "./Select";

const PAGE = 10;

export function SearchSelect<K extends string>({
    label,
    name,
    hint,
    error,
    value: valueProp,
    defaultValue,
    options,
    onChange,
    placeholder,
    size = "md",
    surface = "bg",
    width,
    disabled = false,
    className,
    ref,
}: WebProps<SearchSelectProps<K>> & WithRef<HTMLInputElement>) {
    const [value, setValue] = useControllable<K | undefined>(
        valueProp,
        defaultValue ?? (placeholder === undefined ? options[0]?.key : undefined),
    );
    const id = useId();
    const listId = `${id}-list`;
    const box = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const inputRef = useMemo(() => mergeRefs(input, ref), [ref]);
    const list = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [active, setActive] = useState<K | null>(null);
    const chosen = options.find((o) => o.key === value);
    const needle = q.trim().toLowerCase();
    const shown = needle === "" ? options : options.filter((o) => matches(o, needle));
    const enabled = shown.filter((o) => o.disabled !== true);
    const optionId = (key: K): string =>
        `${id}-o${String(options.findIndex((o) => o.key === key))}`;

    const close = (): void => {
        setOpen(false);
        setQ("");
    };
    const { panel, style, host } = usePopover(open, box, close);
    const show = (): void => {
        if (disabled) return;
        setActive((chosen?.disabled === true ? undefined : chosen?.key) ?? enabled[0]?.key ?? null);
        setOpen(true);
    };
    const pick = (o: SelectOption<K>): void => {
        if (o.disabled === true) return;
        setValue(o.key);
        onChange?.(o.key);
        close();
    };

    useEffect(() => {
        if (!open || active === null) return;
        list.current
            ?.querySelector(`[id="${optionId(active)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    });

    const step = (by: number): void => {
        if (enabled.length === 0) return;
        const at = enabled.findIndex((o) => o.key === active);
        const to =
            at === -1
                ? by > 0
                    ? 0
                    : enabled.length - 1
                : Math.max(0, Math.min(enabled.length - 1, at + by));
        setActive(enabled[to]?.key ?? null);
    };

    const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
        const pressed = enabled.find((o) => o.key === active);
        switch (e.key) {
            case "ArrowDown":
                if (open) step(1);
                else show();
                break;
            case "ArrowUp":
                if (!open) show();
                else if (e.altKey && pressed !== undefined) pick(pressed);
                else step(-1);
                break;
            case "PageDown":
                if (!open) return;
                step(PAGE);
                break;
            case "PageUp":
                if (!open) return;
                step(-PAGE);
                break;
            case "Home":
            case "End":
                // With nothing typed they move through the list; once typing, they move the caret.
                if (!open || q !== "") return;
                setActive(
                    (e.key === "Home" ? enabled[0] : enabled[enabled.length - 1])?.key ?? null,
                );
                break;
            case "Enter":
                if (!open || pressed === undefined) return;
                pick(pressed);
                break;
            case "Escape":
                if (!open) return;
                close();
                break;
            case "Tab":
                close();
                return;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    const describe = label ?? name ?? placeholder;
    const resting = chosen?.label ?? "";
    const menu =
        host === null
            ? null
            : createPortal(
                  <div
                      ref={panel}
                      style={style}
                      className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-pop"
                  >
                      <OptionList
                          ref={list}
                          id={id}
                          listId={listId}
                          label={describe}
                          options={shown}
                          total={options.length}
                          value={value}
                          active={active}
                          optionId={optionId}
                          onActive={setActive}
                          onPick={pick}
                      />
                  </div>,
                  host,
              );

    return (
        <Labelled
            className={className}
            id={id}
            label={label}
            hint={hint}
            error={error}
            optional={false}
            required={false}
        >
            <div
                ref={box}
                className={cx(
                    fieldClass(size, surface, width ?? "full"),
                    `relative flex min-w-0 items-center gap-2 pe-9 focus-within:border-accent ${open ? "border-accent shadow-[0_0_0_3px_var(--accent-weak)]" : ""} ${disabled ? "opacity-60" : ""}`,
                )}
            >
                {chosen?.media !== undefined && q === "" ? (
                    <OptionLead media={chosen.media} />
                ) : null}
                <input
                    ref={inputRef}
                    id={id}
                    name={name}
                    value={open ? q : resting}
                    disabled={disabled}
                    placeholder={
                        open && resting !== "" ? resting : (placeholder ?? strings.ui.choose)
                    }
                    onChange={(e) => {
                        const next = e.target.value;
                        setQ(next);
                        setOpen(true);
                        const n = next.trim().toLowerCase();
                        const first = options.find(
                            (o) => o.disabled !== true && (n === "" || matches(o, n)),
                        );
                        setActive(first?.key ?? null);
                    }}
                    onClick={() => {
                        if (!open) show();
                    }}
                    onKeyDown={onKey}
                    onBlur={(e) => {
                        if (open && !panel.current?.contains(e.relatedTarget)) close();
                    }}
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-autocomplete="list"
                    aria-activedescendant={open && active !== null ? optionId(active) : undefined}
                    aria-invalid={(error !== undefined && error !== null) || undefined}
                    aria-label={label === undefined ? describe : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-ink outline-hidden placeholder:text-muted"
                />
                <Icon
                    name="chevronDown"
                    size={size === "sm" ? 14 : 16}
                    className={`pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted transition ${open ? "rotate-180" : ""}`}
                />
            </div>
            {menu}
        </Labelled>
    );
}
