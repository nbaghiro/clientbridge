import {
    type SelectOption,
    type SelectProps,
    strings,
    useControllable,
} from "@clientbridge/app-core/public";
import {
    type ButtonHTMLAttributes,
    type KeyboardEvent,
    type ReactNode,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";

import { Labelled, fieldClass } from "./Field";
import { Icon } from "./Icon";
import { usePopover } from "./popover";
import { type WebProps, type WithRef, cx, mergeRefs } from "./props";

// Above this many options the open list starts with a search box.
const SEARCH_AFTER = 8;
const PAGE = 10;
const ICON_INSET = { sm: "end-2", md: "end-3", lg: "end-3" } as const;
const ICON_ROOM = { sm: "pe-7", md: "pe-9", lg: "pe-9" } as const;

interface Section<K extends string> {
    group: string | undefined;
    options: SelectOption<K>[];
}

function sections<K extends string>(options: readonly SelectOption<K>[]): Section<K>[] {
    const out: Section<K>[] = [];
    for (const o of options) {
        const at = out.find((s) => s.group === o.group);
        if (at === undefined) out.push({ group: o.group, options: [o] });
        else at.options.push(o);
    }
    return out;
}

function matches(o: SelectOption<string>, needle: string): boolean {
    return (
        o.label.toLowerCase().includes(needle) ||
        (o.detail?.toLowerCase().includes(needle) ?? false) ||
        (o.group?.toLowerCase().includes(needle) ?? false)
    );
}

// The trigger box of a field that opens a picker: a text field's look, with a glyph at the end.
export function PickerTrigger({
    id,
    size,
    width,
    open,
    invalid,
    icon,
    placeholder,
    children,
    ...rest
}: {
    id: string;
    size: "sm" | "md" | "lg";
    width: "full" | "auto";
    open: boolean;
    invalid: boolean;
    icon: "chevronDown" | "calendar" | "clock";
    placeholder: boolean;
    children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "id"> &
    WithRef<HTMLButtonElement>) {
    return (
        <button
            {...rest}
            id={id}
            type="button"
            aria-invalid={invalid || undefined}
            className={cx(
                fieldClass(size, "bg", width),
                `relative flex min-w-0 items-center text-start focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-weak)] ${ICON_ROOM[size]} ${open ? "border-accent shadow-[0_0_0_3px_var(--accent-weak)]" : ""} ${width === "auto" ? "min-w-32" : ""}`,
            )}
        >
            <span className={`min-w-0 flex-1 truncate ${placeholder ? "text-muted" : ""}`}>
                {children}
            </span>
            <Icon
                name={icon}
                size={size === "sm" ? 14 : 16}
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted transition ${ICON_INSET[size]} ${open && icon === "chevronDown" ? "rotate-180" : ""}`}
            />
        </button>
    );
}

export function Select<K extends string>({
    label,
    name,
    hint,
    error,
    value: valueProp,
    defaultValue,
    options,
    onChange,
    placeholder,
    searchable,
    size = "md",
    width,
    disabled = false,
    className,
    ref,
}: WebProps<SelectProps<K>> & WithRef<HTMLButtonElement>) {
    const [value, setValue] = useControllable<K | undefined>(
        valueProp,
        defaultValue ?? (placeholder === undefined ? options[0]?.key : undefined),
    );
    const id = useId();
    const listId = `${id}-list`;
    const trigger = useRef<HTMLButtonElement>(null);
    const triggerRef = useMemo(() => mergeRefs(trigger, ref), [ref]);
    const search = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const typed = useRef({ text: "", at: 0 });
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [active, setActive] = useState<K | null>(null);
    const withSearch = searchable ?? options.length > SEARCH_AFTER;
    const chosen = options.find((o) => o.key === value);
    const needle = q.trim().toLowerCase();
    const shown = needle === "" ? options : options.filter((o) => matches(o, needle));
    const enabled = shown.filter((o) => o.disabled !== true);
    const optionId = (key: K): string =>
        `${id}-o${String(options.findIndex((o) => o.key === key))}`;

    const close = (refocus: boolean): void => {
        setOpen(false);
        setQ("");
        if (refocus) trigger.current?.focus();
    };
    const { panel, style, host, placed } = usePopover(open, trigger, () => {
        close(false);
    });
    const show = (at?: K): void => {
        if (disabled) return;
        setActive(
            at ?? (chosen?.disabled === true ? undefined : chosen?.key) ?? enabled[0]?.key ?? null,
        );
        setOpen(true);
    };
    const pick = (o: SelectOption<K>): void => {
        if (o.disabled === true) return;
        setValue(o.key);
        onChange?.(o.key);
        close(true);
    };

    useEffect(() => {
        if (placed && withSearch) search.current?.focus();
    }, [placed, withSearch]);
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
    const typeAhead = (ch: string): void => {
        const now = Date.now();
        const t = typed.current;
        t.text = now - t.at > 600 ? ch : t.text + ch;
        t.at = now;
        const text = t.text.toLowerCase();
        const at = enabled.findIndex((o) => o.key === active);
        const order = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
        const pool = text.length === 1 ? order : [...enabled.slice(Math.max(at, 0)), ...order];
        const hit = pool.find((o) => o.label.toLowerCase().startsWith(text));
        if (hit === undefined) return;
        if (open) setActive(hit.key);
        else show(hit.key);
    };

    const onKey = (e: KeyboardEvent<HTMLElement>): void => {
        const inSearch = e.currentTarget === search.current;
        if (!open) {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
                e.preventDefault();
                show();
            } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                typeAhead(e.key);
            }
            return;
        }
        const pressed = enabled.find((o) => o.key === active);
        switch (e.key) {
            case "ArrowDown":
                step(1);
                break;
            case "ArrowUp":
                if (e.altKey && pressed !== undefined) {
                    pick(pressed);
                    break;
                }
                step(-1);
                break;
            case "PageDown":
                step(PAGE);
                break;
            case "PageUp":
                step(-PAGE);
                break;
            case "Home":
                if (inSearch) return;
                setActive(enabled[0]?.key ?? null);
                break;
            case "End":
                if (inSearch) return;
                setActive(enabled[enabled.length - 1]?.key ?? null);
                break;
            case "Enter":
                if (pressed !== undefined) pick(pressed);
                break;
            case " ":
                if (inSearch) return;
                if (typed.current.text !== "" && Date.now() - typed.current.at < 600) {
                    typeAhead(" ");
                    break;
                }
                if (pressed !== undefined) pick(pressed);
                break;
            case "Escape":
                close(true);
                break;
            case "Tab":
                close(false);
                if (inSearch) {
                    trigger.current?.focus();
                    return;
                }
                return;
            default:
                if (!inSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey)
                    typeAhead(e.key);
                else return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    const describe = label ?? name ?? placeholder;
    const menu =
        host === null
            ? null
            : createPortal(
                  <div
                      ref={panel}
                      style={style}
                      className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-pop"
                  >
                      {withSearch ? (
                          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
                              <Icon name="search" size={15} className="text-muted" />
                              <input
                                  ref={search}
                                  value={q}
                                  onChange={(e) => {
                                      setQ(e.target.value);
                                      const needle2 = e.target.value.trim().toLowerCase();
                                      const first = options.find(
                                          (o) =>
                                              o.disabled !== true &&
                                              (needle2 === "" || matches(o, needle2)),
                                      );
                                      setActive(first?.key ?? null);
                                  }}
                                  onKeyDown={onKey}
                                  placeholder={strings.ui.searchOptions}
                                  role="combobox"
                                  aria-label={strings.ui.searchOptions}
                                  aria-expanded
                                  aria-controls={listId}
                                  aria-autocomplete="list"
                                  aria-activedescendant={
                                      active === null ? undefined : optionId(active)
                                  }
                                  autoComplete="off"
                                  spellCheck={false}
                                  className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-ink outline-hidden placeholder:text-muted"
                              />
                          </div>
                      ) : null}
                      <div
                          ref={list}
                          id={listId}
                          role="listbox"
                          aria-label={describe}
                          tabIndex={-1}
                          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
                      >
                          {shown.length === 0 ? (
                              <p className="px-3 py-5 text-center text-sm text-muted">
                                  {options.length === 0
                                      ? strings.ui.noOptions
                                      : strings.ui.noMatches}
                              </p>
                          ) : (
                              sections(shown).map((s, si) => {
                                  const rows = s.options.map((o) => {
                                      const selected = o.key === value;
                                      const isActive = o.key === active;
                                      return (
                                          <div
                                              key={o.key}
                                              id={optionId(o.key)}
                                              role="option"
                                              aria-selected={selected}
                                              aria-disabled={o.disabled === true || undefined}
                                              onMouseDown={(e) => {
                                                  e.preventDefault();
                                              }}
                                              onMouseMove={() => {
                                                  if (o.disabled !== true && !isActive)
                                                      setActive(o.key);
                                              }}
                                              onClick={() => {
                                                  pick(o);
                                              }}
                                              className={`mx-1 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                                                  o.disabled === true
                                                      ? "cursor-default text-muted opacity-60"
                                                      : `cursor-pointer ${isActive ? "bg-bg" : ""}`
                                              } ${selected ? "font-semibold text-ink" : "text-ink-soft"}`}
                                          >
                                              <span className="min-w-0 flex-1 truncate">
                                                  {o.label}
                                              </span>
                                              {o.detail !== undefined ? (
                                                  <span className="shrink-0 text-xs font-normal text-muted">
                                                      {o.detail}
                                                  </span>
                                              ) : null}
                                              <span className="flex w-4 shrink-0 justify-end text-accent">
                                                  {selected ? (
                                                      <Icon name="check" size={15} />
                                                  ) : null}
                                              </span>
                                          </div>
                                      );
                                  });
                                  if (s.group === undefined) return rows;
                                  const headId = `${id}-g${String(si)}`;
                                  return (
                                      <div key={headId} role="group" aria-labelledby={headId}>
                                          <div
                                              id={headId}
                                              role="presentation"
                                              className="px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted"
                                          >
                                              {s.group}
                                          </div>
                                          {rows}
                                      </div>
                                  );
                              })
                          )}
                      </div>
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
            <PickerTrigger
                ref={triggerRef}
                id={id}
                size={size}
                width={width ?? (size === "sm" ? "auto" : "full")}
                open={open}
                invalid={error !== undefined && error !== null}
                icon="chevronDown"
                placeholder={chosen === undefined}
                disabled={disabled}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={
                    open && !withSearch && active !== null ? optionId(active) : undefined
                }
                aria-label={label === undefined ? describe : undefined}
                onClick={() => {
                    if (open) close(true);
                    else show();
                }}
                onKeyDown={onKey}
                onBlur={(e) => {
                    if (open && !withSearch && !panel.current?.contains(e.relatedTarget))
                        close(false);
                }}
            >
                {chosen?.label ?? placeholder ?? strings.ui.choose}
            </PickerTrigger>
            {menu}
        </Labelled>
    );
}
