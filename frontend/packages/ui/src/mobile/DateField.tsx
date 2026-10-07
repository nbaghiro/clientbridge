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
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { Extras, Label } from "./Field";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";
import type { NativeProps } from "./props";
import { PickerTrigger, Select } from "./Select";

const c = theme.colors;
const YEAR_ROW = 44;

export function DateField({
    label,
    name,
    hint,
    error,
    optional = false,
    required = false,
    placeholder,
    size = "md",
    disabled = false,
    value: valueProp,
    defaultValue = "",
    onChange,
    min,
    max,
    style,
}: NativeProps<DateFieldProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const [open, setOpen] = useState(false);
    const month = useMonthGrid(value, min, max);
    const years = useRef<ScrollView>(null);
    const day = parseDateKey(value);
    const today = dateKey(new Date());
    const todayOk =
        (min === undefined || min === "" || today >= min) &&
        (max === undefined || max === "" || today <= max);
    const pick = (key: string): void => {
        setValue(key);
        setOpen(false);
    };
    return (
        <View style={style}>
            {label !== undefined ? (
                <Label text={label} optional={optional} required={required} />
            ) : null}
            <PickerTrigger
                label={label ?? name ?? placeholder ?? strings.ui.pickDate}
                text={day === null ? (placeholder ?? strings.ui.pickDate) : formatPickedDay(day)}
                placeholder={day === null}
                icon="calendar"
                size={size}
                open={open}
                disabled={disabled}
                invalid={error !== undefined && error !== null}
                onPress={() => {
                    month.reset();
                    setOpen(true);
                }}
            />
            <Extras hint={hint} error={error} />
            <Modal
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
            >
                {label !== undefined || name !== undefined ? (
                    <Text style={styles.sheetTitle} accessibilityRole="header">
                        {label ?? name}
                    </Text>
                ) : null}
                <View style={styles.head}>
                    <IconButton
                        icon="chevronLeft"
                        label={strings.ui.previousMonth}
                        size="sm"
                        disabled={!month.canPrev || month.view === "years"}
                        onPress={() => {
                            month.move("month", -1);
                        }}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={strings.ui.chooseYear(month.title)}
                        accessibilityState={{ expanded: month.view === "years" }}
                        onPress={() => {
                            month.setView(month.view === "years" ? "days" : "years");
                        }}
                        style={styles.title}
                    >
                        <Text style={styles.titleText}>{month.title}</Text>
                        <Icon
                            name={month.view === "years" ? "chevronUp" : "chevronDown"}
                            size={14}
                            color={c.muted}
                        />
                    </Pressable>
                    <IconButton
                        icon="chevronRight"
                        label={strings.ui.nextMonth}
                        size="sm"
                        disabled={!month.canNext || month.view === "years"}
                        onPress={() => {
                            month.move("month", 1);
                        }}
                    />
                </View>
                {month.view === "years" ? (
                    <ScrollView
                        ref={years}
                        style={styles.years}
                        contentContainerStyle={styles.yearGrid}
                        onLayout={() => {
                            const at = month.years.findIndex((y) => y.selected);
                            years.current?.scrollTo({
                                y: Math.max(0, Math.floor(at / 4) * YEAR_ROW - YEAR_ROW * 2),
                                animated: false,
                            });
                        }}
                    >
                        {month.years.map((y) => (
                            <Pressable
                                key={y.year}
                                accessibilityRole="button"
                                accessibilityState={{ selected: y.selected }}
                                onPress={() => {
                                    month.pickYear(y.year);
                                }}
                                style={[styles.year, y.selected && styles.on]}
                            >
                                <Text style={[styles.yearText, y.selected && styles.onText]}>
                                    {y.year}
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : (
                    <View>
                        <View style={styles.week}>
                            {month.weekdays.map((w) => (
                                <Text key={w} style={styles.weekday} accessibilityLabel={w}>
                                    {w.slice(0, 2)}
                                </Text>
                            ))}
                        </View>
                        {month.weeks.map((week) => (
                            <View key={week[0]?.key} style={styles.week}>
                                {week.map((d) => (
                                    <Pressable
                                        key={d.key}
                                        accessibilityRole="button"
                                        accessibilityLabel={d.label}
                                        accessibilityState={{
                                            selected: d.selected,
                                            disabled: d.disabled,
                                        }}
                                        disabled={d.disabled}
                                        onPress={() => {
                                            pick(d.key);
                                        }}
                                        style={({ pressed }) => [
                                            styles.day,
                                            pressed && styles.dayPressed,
                                            d.selected && styles.on,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.dayText,
                                                !d.inMonth && styles.outside,
                                                d.today && styles.today,
                                                d.selected && styles.onText,
                                                d.disabled && styles.off,
                                            ]}
                                        >
                                            {d.day}
                                        </Text>
                                        {d.today && !d.selected ? (
                                            <View style={styles.dot} />
                                        ) : null}
                                    </Pressable>
                                ))}
                            </View>
                        ))}
                    </View>
                )}
                {month.view === "days" && (todayOk || (optional && value !== "")) ? (
                    <View style={styles.foot}>
                        {todayOk ? (
                            <Button
                                variant="link"
                                size="sm"
                                onPress={() => {
                                    pick(today);
                                }}
                            >
                                {strings.common.today}
                            </Button>
                        ) : (
                            <View />
                        )}
                        {optional && value !== "" ? (
                            <Button
                                variant="quiet"
                                size="sm"
                                onPress={() => {
                                    pick("");
                                }}
                            >
                                {strings.ui.clear}
                            </Button>
                        ) : null}
                    </View>
                ) : null}
            </Modal>
        </View>
    );
}

export function TimeField({
    label,
    name,
    hint,
    error,
    placeholder,
    size = "md",
    disabled,
    value: valueProp,
    defaultValue = "",
    onChange,
    step = 15,
    min,
    max,
    style,
}: NativeProps<TimeFieldProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const options = useMemo(() => clockOptions(step, min, max, value), [step, min, max, value]);
    return (
        <Select
            style={style}
            label={label}
            name={name}
            hint={hint}
            error={error}
            placeholder={placeholder ?? strings.ui.pickTime}
            size={size}
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
    optional = false,
    required = false,
    size,
    disabled,
    value: valueProp,
    defaultValue = "",
    onChange,
    min,
    step,
    style,
}: NativeProps<DateTimeFieldProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    const day = value.slice(0, 10);
    const time = value.slice(11, 16);
    const named = label ?? name ?? "";
    return (
        <View style={style}>
            {label !== undefined ? (
                <Label text={label} optional={optional} required={required} />
            ) : null}
            <View style={styles.pair}>
                <DateField
                    style={styles.pairDay}
                    name={strings.ui.dateTimeDay(named)}
                    size={size}
                    disabled={disabled}
                    min={min}
                    required={required}
                    value={day}
                    onChange={(d) => {
                        setValue(d === "" ? "" : `${d}T${time === "" ? "09:00" : time}`);
                    }}
                />
                <TimeField
                    style={styles.pairTime}
                    name={strings.ui.dateTimeTime(named)}
                    size={size}
                    disabled={disabled}
                    step={step}
                    value={time}
                    onChange={(t) => {
                        setValue(`${day === "" ? dateKey(new Date()) : day}T${t}`);
                    }}
                />
            </View>
            <Extras hint={hint} error={error} />
        </View>
    );
}

const styles = StyleSheet.create({
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700", marginBottom: 12 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
    },
    title: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: theme.radius,
    },
    titleText: { color: c.ink, fontSize: 16, fontWeight: "700" },
    week: { flexDirection: "row" },
    weekday: {
        flex: 1,
        textAlign: "center",
        color: c.muted,
        fontSize: 11,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingBottom: 6,
    },
    day: {
        flex: 1,
        height: 44,
        margin: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.radius,
    },
    dayPressed: { backgroundColor: c.bg },
    dayText: { color: c.ink, fontSize: 15, fontVariant: ["tabular-nums"] },
    outside: { color: c.muted },
    today: { color: c.accent, fontWeight: "700" },
    off: { opacity: 0.35 },
    on: { backgroundColor: c.accent },
    onText: { color: c.accentInk, fontWeight: "700" },
    dot: {
        position: "absolute",
        bottom: 6,
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: c.accent,
    },
    years: { maxHeight: 300 },
    yearGrid: { flexDirection: "row", flexWrap: "wrap" },
    year: {
        width: "25%",
        height: YEAR_ROW,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: theme.radius,
    },
    yearText: { color: c.inkSoft, fontSize: 15, fontVariant: ["tabular-nums"] },
    foot: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
        paddingTop: 8,
        borderTopWidth: theme.borderWidth,
        borderTopColor: c.borderSoft,
    },
    pair: { flexDirection: "row", gap: 8 },
    pairDay: { flex: 3 },
    pairTime: { flex: 2 },
});
