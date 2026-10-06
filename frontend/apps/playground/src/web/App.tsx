import * as ui from "@clientbridge/ui";
import { Button, Choice, ConfirmHost, Icon, SearchField, Select } from "@clientbridge/ui";
import { THEME_KEYS, THEME_LABELS, type ThemeKey } from "@clientbridge/tokens";
import { useEffect, useMemo, useRef, useState } from "react";

import { Rendered } from "../Render";
import { type Device, type Platform, type Route, frameSrc, pageHash } from "../routes";
import type { ControlValue, StoryEntry } from "../story";
import { PAGES, findPage } from "../stories";
import { Controls } from "./Controls";
import { PhoneFrame } from "./PhoneFrame";
import { snippet } from "./snippet";
import { webKit } from "./WebKit";

type PageRoute = Extract<Route, { kind: "page" }>;
type Values = Record<string, Record<string, ControlValue>>;

const go = (hash: string): void => {
    window.location.hash = hash;
};

function initialValues(stories: readonly StoryEntry[]): Values {
    const out: Values = {};
    for (const s of stories) {
        const first = s.examples[0];
        if (!s.controls || !first) continue;
        const props = first.props(webKit) as Record<string, unknown>;
        out[s.component] = Object.fromEntries(
            Object.keys(s.controls).flatMap((k) => {
                const v = props[k];
                return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                    ? [[k, v] as const]
                    : [];
            }),
        );
    }
    return out;
}

function CopyButton({ text }: { text: string }) {
    const [done, setDone] = useState(false);
    return (
        <Button
            size="sm"
            variant="outline"
            icon={done ? "check" : "copy"}
            onPress={() => {
                navigator.clipboard.writeText(text).then(
                    () => {
                        setDone(true);
                        setTimeout(() => {
                            setDone(false);
                        }, 1500);
                    },
                    () => undefined,
                );
            }}
        >
            {done ? "Copied" : "Copy"}
        </Button>
    );
}

function Section({
    entry,
    route,
    values,
    setValue,
}: {
    entry: StoryEntry;
    route: PageRoute;
    values: Record<string, ControlValue> | undefined;
    setValue: (name: string, value: ControlValue) => void;
}) {
    const first = entry.examples[0];
    const live = first ? { ...(first.props(webKit) as Record<string, unknown>), ...values } : {};
    const code = snippet(entry.component, live);
    return (
        <section className="space-y-4" aria-labelledby={`${entry.component}-title`}>
            <div>
                <h2
                    id={`${entry.component}-title`}
                    className="font-display text-lg font-bold text-ink"
                >
                    {entry.component}
                </h2>
                <p className="mt-0.5 text-sm text-muted">{entry.summary}</p>
            </div>
            {entry.controls && first ? (
                <div className="rounded-lg border border-line bg-surface shadow-card">
                    <div className="border-b border-line-soft px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                        Live props
                    </div>
                    <div className="space-y-4 p-4">
                        <Controls
                            controls={entry.controls}
                            values={values ?? {}}
                            onChange={setValue}
                        />
                        <div className="relative rounded-md border border-dashed border-line bg-bg p-4">
                            <Rendered
                                entry={entry}
                                example={first}
                                kit={webKit}
                                ui={ui}
                                values={values}
                            />
                        </div>
                    </div>
                </div>
            ) : null}
            <div className="rounded-lg border border-line bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Import and example
                    </span>
                    <CopyButton text={code} />
                </div>
                <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">
                    {code}
                </pre>
            </div>
            {entry.examples.map((ex) => (
                <article
                    key={ex.key}
                    id={ex.key}
                    data-example={ex.key}
                    className={`relative rounded-lg border bg-surface shadow-card ${route.example === ex.key ? "border-accent" : "border-line"}`}
                >
                    <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
                        <h3 className="text-sm font-semibold text-ink">{ex.title}</h3>
                        <a
                            href={pageHash({ ...route, example: ex.key })}
                            className="text-xs font-medium text-accent hover:underline"
                            aria-label={`Link to ${ex.title}`}
                        >
                            #{ex.key}
                        </a>
                    </header>
                    <div className="relative min-h-16 p-4">
                        <Rendered entry={entry} example={ex} kit={webKit} ui={ui} />
                    </div>
                </article>
            ))}
        </section>
    );
}

function Phones({ route, values }: { route: PageRoute; values: Values }) {
    const frames = useRef<(HTMLIFrameElement | null)[]>([]);
    const latest = useRef(values);
    latest.current = values;
    const send = (): void => {
        for (const f of frames.current) {
            f?.contentWindow?.postMessage(
                { type: "playground-controls", values: latest.current },
                "*",
            );
        }
    };
    useEffect(send, [values]);
    useEffect(() => {
        const on = (e: MessageEvent): void => {
            if ((e.data as { type?: string } | null)?.type === "playground-frame-ready") send();
        };
        window.addEventListener("message", on);
        return () => {
            window.removeEventListener("message", on);
        };
    }, []);
    const devices = route.device === "both" ? (["iphone", "android"] as const) : [route.device];
    const tail = route.example ? `&example=${route.example}` : "";
    return (
        <div className="flex gap-4">
            {devices.map((d, i) => (
                <PhoneFrame
                    key={`${d}-${route.theme}-${route.name}`}
                    device={d}
                    src={`${import.meta.env.BASE_URL}${frameSrc(route.name, d, route.theme)}${tail}`}
                    frameRef={(el) => {
                        frames.current[i] = el;
                    }}
                />
            ))}
        </div>
    );
}

function Toolbar({ route }: { route: PageRoute }) {
    return (
        <div className="flex flex-wrap items-end gap-3">
            <Choice
                label="Platform"
                layout="segmented"
                options={[
                    { key: "both", label: "Both" },
                    { key: "web", label: "Web" },
                    { key: "mobile", label: "Mobile" },
                ]}
                value={route.platform}
                onChange={(platform: Platform) => {
                    go(pageHash({ ...route, platform }));
                }}
            />
            <Choice
                label="Device"
                layout="segmented"
                options={[
                    { key: "both", label: "iPhone and Android" },
                    { key: "iphone", label: "iPhone" },
                    { key: "android", label: "Android" },
                ]}
                value={route.device}
                onChange={(device: Device) => {
                    go(pageHash({ ...route, device }));
                }}
            />
            <Select
                name="Theme"
                size="sm"
                value={route.theme}
                options={THEME_KEYS.map((k) => ({ key: k, label: THEME_LABELS[k] }))}
                onChange={(theme: ThemeKey) => {
                    go(pageHash({ ...route, theme }));
                }}
            />
        </div>
    );
}

function ComponentPage({ route }: { route: PageRoute }) {
    const page = findPage(route.name);
    const stories = useMemo(() => page?.stories ?? [], [page]);
    const [values, setValues] = useState<Values>(() => initialValues(stories));
    useEffect(() => {
        setValues(initialValues(stories));
    }, [stories]);
    useEffect(() => {
        if (route.example !== null)
            document.getElementById(route.example)?.scrollIntoView({ block: "start" });
    }, [route.example]);
    if (!page) return <p className="p-8 text-sm text-muted">No story for {route.name}.</p>;
    return (
        <div className="space-y-6 px-8 py-8" data-page={page.name}>
            <header className="space-y-3">
                <h1 className="font-display text-2xl font-bold text-ink">{page.name}</h1>
                <Toolbar route={route} />
            </header>
            <div
                className={`grid gap-8 ${route.platform === "both" ? "xl:grid-cols-[minmax(0,1fr)_auto]" : ""}`}
            >
                {route.platform !== "mobile" ? (
                    <div className="min-w-0 space-y-10">
                        {stories.map((entry) => (
                            <Section
                                key={entry.component}
                                entry={entry}
                                route={route}
                                values={values[entry.component]}
                                setValue={(name, value) => {
                                    setValues((v) => {
                                        const rest = Object.entries(
                                            v[entry.component] ?? {},
                                        ).filter(([k]) => k !== name);
                                        const next =
                                            value === "" ? rest : [...rest, [name, value] as const];
                                        return {
                                            ...v,
                                            [entry.component]: Object.fromEntries(next),
                                        };
                                    });
                                }}
                            />
                        ))}
                    </div>
                ) : null}
                {route.platform !== "web" ? (
                    <div className="xl:sticky xl:top-8 xl:self-start">
                        <Phones route={route} values={values} />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function Index({ theme }: { theme: ThemeKey }) {
    return (
        <div className="px-8 py-8">
            <h1 className="font-display text-2xl font-bold text-ink">Shared components</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
                Every component in @clientbridge/ui, drawn on web and, through react-native-web, on
                iPhone and Android.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {PAGES.map((p) => (
                    <li key={p.name}>
                        <a
                            href={pageHash({ name: p.name, theme })}
                            className="block h-full rounded-lg border border-line bg-surface p-4 shadow-card transition hover:border-accent-line"
                        >
                            <span className="font-semibold text-ink">{p.name}</span>
                            <span className="mt-1 block text-xs text-muted">
                                {p.stories[0]?.summary}
                            </span>
                            <span className="mt-2 block text-xs text-muted">
                                {p.stories.reduce((n, s) => n + s.examples.length, 0)} examples
                            </span>
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function App({ route }: { route: Exclude<Route, { kind: "frame" }> }) {
    const [filter, setFilter] = useState("");
    useEffect(() => {
        document.documentElement.dataset.theme = route.theme;
    }, [route.theme]);
    const current = route.kind === "page" ? route.name : null;
    const shown = PAGES.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
    return (
        <div className="flex h-full">
            <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
                <a
                    href="#/"
                    className="flex items-center gap-2 px-5 pb-4 pt-6 font-display text-lg font-bold text-ink"
                >
                    <Icon name="today" />
                    Playground
                </a>
                <div className="px-3 pb-3">
                    <SearchField
                        placeholder="Find a component"
                        value={filter}
                        onChange={setFilter}
                    />
                </div>
                <nav aria-label="Components" className="flex-1 overflow-y-auto px-3 pb-6">
                    {shown.map((p) => (
                        <a
                            key={p.name}
                            href={pageHash({ name: p.name, theme: route.theme })}
                            aria-current={current === p.name ? "page" : undefined}
                            className={`block rounded-md px-3 py-1.5 text-sm ${current === p.name ? "bg-accent-weak font-semibold text-accent" : "text-ink-soft hover:bg-bg"}`}
                        >
                            {p.name}
                        </a>
                    ))}
                </nav>
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto">
                {route.kind === "page" ? (
                    <ComponentPage key={route.name} route={route} />
                ) : (
                    <Index theme={route.theme} />
                )}
            </main>
            <ConfirmHost />
        </div>
    );
}
