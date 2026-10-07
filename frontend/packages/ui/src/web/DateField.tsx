import {
    type DateFieldProps,
    type DateTimeFieldProps,
    type TimeFieldProps,
    clockOptions,
    dateKey,
    formatPickedDay,
    parseDateKey,
    strings,
    useControllable,
    useMonthGrid,
} from "@clientbridge/app-core/public";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Field, Labelled } from "./Field";
import { Icon } from "./Icon";
import { moveFocus } from "./keys";
import { usePopover } from "./popover";
import { type WebProps, type WithRef, cx, mergeRefs } from "./props";
import { PickerTrigger, Select } from "./Select";

const NAV =
    "flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30";
const FOCUSABLE = "button:not([disabled])";

export function DateField({
    label,
    name,
    hint,
    error,
    optional = false,
    required = false,
    placeholder,
    size = "md",
    width = "full",
    disabled = false,
    value: valueProp,
    defaultValue = "",
    onChange,
    min,
    max,
    className,
    ref,
}: WebProps<DateFieldProps> & WithRef<HTMLButtonElement>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const triggerRef = useMemo(() => mergeRefs(trigger, ref), [ref]);
    const grid = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const month = useMonthGrid(value, min, max);
    const close = (refocus: boolean): void => {
        setOpen(false);
        if (refocus) trigger.current?.focus();
    };
    const { panel, style, host, placed } = usePopover(
        open,
        trigger,
        () => {
            close(false);
        },
        288,
    );
    const day = parseDateKey(value);
    const today = dateKey(new Date());
    const todayOk =
        (min === undefined || min === "" || today >= min) &&
        (max === undefined || max === "" || today <= max);
    const pick = (key: string): void => {
        setValue(key);
        close(true);
    };

    useEffect(() => {
        if (!placed) return;
        const target =
            month.view === "years"
                ? panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
                : grid.current?.querySelector<HTMLElement>('[tabindex="0"]');
        target?.focus({ preventScroll: month.view === "days" });
        if (month.view === "years") target?.scrollIntoView({ block: "center" });
    }, [placed, month.active, month.view, panel]);

    const onGridKey = (e: KeyboardEvent<HTMLDivElement>): void => {
        const moves: Record<string, () => void> = {
            ArrowLeft: () => {
                month.move("day", -1);
            },
            ArrowRight: () => {
                month.move("day", 1);
            },
            ArrowUp: () => {
                month.move("week", -1);
            },
            ArrowDown: () => {
                month.move("week", 1);
            },
            Home: () => {
                month.move("weekEdge", -1);
            },
            End: () => {
                month.move("weekEdge", 1);
            },
            PageUp: () => {
                month.move(e.shiftKey ? "year" : "month", -1);
            },
            PageDown: () => {
                month.move(e.shiftKey ? "year" : "month", 1);
            },
        };
        const go = moves[e.key];
        if (go === undefined) return;
        e.preventDefault();
        go();
    };
    const onPanelKey = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (month.view === "years") month.setView("days");
            else close(true);
            return;
        }
        if (e.key !== "Tab") return;
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (el) => el.tabIndex >= 0,
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (
            (e.shiftKey && document.activeElement === first) ||
            (!e.shiftKey && document.activeElement === last)
        ) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
        }
    };

    const dialogLabel = label ?? name ?? placeholder ?? strings.ui.pickDate;
    const popover =
        host === null
            ? null
            : createPortal(
                  <div
                      ref={panel}
                      style={style}
                      role="dialog"
                      aria-label={dialogLabel}
                      onKeyDown={onPanelKey}
                      className="z-50 w-[288px] overflow-y-auto rounded-lg border border-line bg-surface p-3 text-ink shadow-pop"
                  >
                      <div className="mb-2 flex items-center justify-between gap-1">
                          <button
                              type="button"
                              className={NAV}
                              aria-label={strings.ui.previousMonth}
                              disabled={!month.canPrev || month.view === "years"}
                              onClick={() => {
                                  month.move("month", -1);
                              }}
                          >
                              <Icon name="chevronLeft" size={16} />
                          </button>
                          <button
                              type="button"
                              aria-label={strings.ui.chooseYear(month.title)}
                              aria-expanded={month.view === "years"}
                              onClick={() => {
                                  month.setView(month.view === "years" ? "days" : "years");
                              }}
                              className="flex items-center gap-1 rounded-md px-2 py-1 font-display text-sm font-bold text-ink transition hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                          >
                              {month.title}
                              <Icon
                                  name="chevronDown"
                                  size={14}
                                  className={`text-muted transition ${month.view === "years" ? "rotate-180" : ""}`}
                              />
                          </button>
                          <button
                              type="button"
                              className={NAV}
                              aria-label={strings.ui.nextMonth}
                              disabled={!month.canNext || month.view === "years"}
                              onClick={() => {
                                  month.move("month", 1);
                              }}
                          >
                              <Icon name="chevronRight" size={16} />
                          </button>
                      </div>
                      {month.view === "years" ? (
                          <div
                              className="grid max-h-[252px] grid-cols-4 gap-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
                              onKeyDown={(e) => {
                                  moveFocus(e, FOCUSABLE, "both");
                              }}
                          >
                              {month.years.map((y) => (
                                  <button
                                      key={y.year}
                                      type="button"
                                      aria-pressed={y.selected}
                                      tabIndex={y.selected ? 0 : -1}
                                      onClick={() => {
                                          month.pickYear(y.year);
                                      }}
                                      className={`rounded-md py-2 text-sm tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                                          y.selected
                                              ? "bg-accent font-semibold text-accent-ink"
                                              : "text-ink-soft hover:bg-bg hover:text-ink"
                                      }`}
                                  >
                                      {y.year}
                                  </button>
                              ))}
                          </div>
                      ) : (
                          <div
                              ref={grid}
                              role="grid"
                              aria-label={month.title}
                              onKeyDown={onGridKey}
                          >
                              <div role="row" className="grid grid-cols-7">
                                  {month.weekdays.map((w) => (
                                      <span
                                          key={w}
                                          role="columnheader"
                                          aria-label={w}
                                          className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted"
                                      >
                                          {w.slice(0, 2)}
                                      </span>
                                  ))}
                              </div>
                              {month.weeks.map((week) => (
                                  <div key={week[0]?.key} role="row" className="grid grid-cols-7">
                                      {week.map((d) => (
                                          <button
                                              key={d.key}
                                              type="button"
                                              role="gridcell"
                                              aria-label={d.label}
                                              aria-selected={d.selected}
                                              aria-current={d.today ? "date" : undefined}
                                              aria-disabled={d.disabled || undefined}
                                              tabIndex={d.key === month.active ? 0 : -1}
                                              onClick={() => {
                                                  if (!d.disabled) pick(d.key);
                                                  else month.setActive(d.key);
                                              }}
                                              onKeyDown={(e) => {
                                                  if (
                                                      (e.key === "Enter" || e.key === " ") &&
                                                      d.disabled
                                                  )
                                                      e.preventDefault();
                                              }}
                                              className={`relative m-px flex h-9 items-center justify-center rounded-md text-sm tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                                                  d.selected
                                                      ? "bg-accent font-semibold text-accent-ink"
                                                      : d.disabled
                                                        ? "cursor-default text-muted opacity-40"
                                                        : `hover:bg-bg hover:text-ink ${d.inMonth ? "text-ink" : "text-muted"} ${d.today ? "font-semibold text-accent" : ""}`
                                              }`}
                                          >
                                              {d.day}
                                              {d.today && !d.selected ? (
                                                  <span
                                                      aria-hidden
                                                      className="absolute bottom-1 h-1 w-1 rounded-full bg-accent"
                                                  />
                                              ) : null}
                                          </button>
                                      ))}
                                  </div>
                              ))}
                          </div>
                      )}
                      {month.view === "days" && (todayOk || (optional && value !== "")) ? (
                          <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2">
                              {todayOk ? (
                                  <button
                                      type="button"
                                      onClick={() => {
                                          pick(today);
                                      }}
                                      className="rounded-md px-2 py-1 text-sm font-semibold text-accent transition hover:bg-accent-weak hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
                                  >
                                      {strings.common.today}
                                  </button>
                              ) : (
                                  <span />
                              )}
                              {optional && value !== "" ? (
                                  <button
                                      type="button"
                                      onClick={() => {
                                          pick("");
                                      }}
                                      className="rounded-md px-2 py-1 text-sm text-muted transition hover:bg-bg hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                                  >
                                      {strings.ui.clear}
                                  </button>
                              ) : null}
                          </div>
                      ) : null}
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
            optional={optional}
            required={required}
        >
            <PickerTrigger
                ref={triggerRef}
                id={id}
                size={size}
                width={width}
                open={open}
                invalid={error !== undefined && error !== null}
                icon="calendar"
                placeholder={day === null}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={
                    label === undefined ? (name ?? placeholder ?? strings.ui.pickDate) : undefined
                }
                onClick={() => {
                    if (open) {
                        close(true);
                        return;
                    }
                    month.reset();
                    setOpen(true);
                }}
                onKeyDown={(e) => {
                    if (!open && e.key === "ArrowDown") {
                        e.preventDefault();
                        month.reset();
                        setOpen(true);
                    }
                }}
            >
                {day === null ? (placeholder ?? strings.ui.pickDate) : formatPickedDay(day)}
            </PickerTrigger>
            {popover}
        </Labelled>
    );
}

export function TimeField({
    label,
    name,
    hint,
    error,
    placeholder,
    size = "md",
    width = "full",
    disabled,
    value: valueProp,
    defaultValue = "",
    onChange,
    step = 15,
    min,
    max,
    className,
    ref,
}: WebProps<TimeFieldProps> & WithRef<HTMLButtonElement>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const options = useMemo(() => clockOptions(step, min, max, value), [step, min, max, value]);
    return (
        <Select
            ref={ref}
            className={className}
            label={label}
            name={name}
            hint={hint}
            error={error}
            placeholder={placeholder ?? strings.ui.pickTime}
            size={size}
            width={width}
            disabled={disabled}
            options={options}
            value={value}
            onChange={setValue}
        />
    );
}

export function DateTimeField({
    label,
    name,
    hint,
    error,
    optional,
    required,
    size,
    disabled,
    value: valueProp,
    defaultValue = "",
    onChange,
    min,
    step,
    className,
}: WebProps<DateTimeFieldProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const day = value.slice(0, 10);
    const time = value.slice(11, 16);
    const named = label ?? name ?? "";
    const row = (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-2">
            <DateField
                name={strings.ui.dateTimeDay(named)}
                size={size}
                disabled={disabled}
                min={min}
                value={day}
                onChange={(d) => {
                    setValue(d === "" ? "" : `${d}T${time === "" ? "09:00" : time}`);
                }}
            />
            <TimeField
                name={strings.ui.dateTimeTime(named)}
                size={size}
                disabled={disabled}
                step={step}
                value={time}
                onChange={(t) => {
                    setValue(`${day === "" ? dateKey(new Date()) : day}T${t}`);
                }}
            />
        </div>
    );
    if (label === undefined) return <div className={cx(className)}>{row}</div>;
    return (
        <Field
            className={className}
            label={label}
            hint={hint}
            error={error}
            optional={optional}
            required={required}
        >
            {row}
        </Field>
    );
}
