import { Select, TextField, Toggle } from "@clientbridge/ui";

import type { Control, ControlValue } from "../story";

export function Controls({
    controls,
    values,
    onChange,
}: {
    controls: Readonly<Record<string, Control>>;
    values: Readonly<Record<string, ControlValue>>;
    onChange: (name: string, value: ControlValue) => void;
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(controls).map(([name, c]) => {
                const v = values[name];
                if (c.type === "boolean") {
                    return (
                        <Toggle
                            key={name}
                            label={name}
                            value={v === true}
                            onChange={(next) => {
                                onChange(name, next);
                            }}
                        />
                    );
                }
                if (c.type === "select") {
                    return (
                        <Select
                            key={name}
                            label={name}
                            size="sm"
                            value={typeof v === "string" ? v : ""}
                            options={[
                                { key: "", label: "default" },
                                ...c.options.map((o) => ({ key: o, label: o })),
                            ]}
                            onChange={(next) => {
                                onChange(name, next);
                            }}
                        />
                    );
                }
                return (
                    <TextField
                        key={name}
                        label={name}
                        size="sm"
                        type={c.type === "number" ? "number" : "text"}
                        value={String(v ?? "")}
                        {...(c.type === "number"
                            ? {
                                  min: c.min === undefined ? undefined : String(c.min),
                                  max: c.max === undefined ? undefined : String(c.max),
                                  step: c.step === undefined ? undefined : String(c.step),
                              }
                            : {})}
                        onChange={(next) => {
                            onChange(name, c.type === "number" ? Number(next) : next);
                        }}
                    />
                );
            })}
        </div>
    );
}
