import * as ui from "@clientbridge/ui";
import { Button, Choice, ConfirmHost, Icon, SearchField, Select } from "@clientbridge/ui";
import { THEME_KEYS, THEME_LABELS, type ThemeKey } from "@clientbridge/tokens";
import {
    type ComponentType,
    type ReactNode,
    Suspense,
    lazy,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { Rendered } from "../Render";
import { type Device, type Platform, type Route, frameSrc, pageHash, parseHash } from "../routes";
import type { ControlValue, StoryEntry } from "../story";
import { PAGES, findPage } from "../stories";
import { Controls } from "./Controls";
import { PhoneFrame } from "./PhoneFrame";
import { snippet } from "./snippet";
import { webKit } from "./WebKit";

type PageRoute = Extract<Route, { kind: "page" }>;
type Values = Record<string, Record<string, ControlValue>>;
type Phone = "iphone" | "android";

interface InlineProps {
    page: string;
    component: string;
    example: string;
    device: Phone;
    values?: Readonly<Record<string, ControlValue>> | undefined;
}

const PHONE_WIDTH = { iphone: 393, android: 412 } as const;
const PHONE_LABEL = { iphone: "iPhone", android: "Android" } as const;

// The React Native theme is read once when the mobile entry loads, so a theme change reloads the page.
const bootTheme = parseHash(window.location.hash).theme;
let mobileLoaded = false;
const inlines = import.meta.glob<{ default: ComponentType<InlineProps> }>("../mobile/Inline.tsx");
const MobileInline = lazy(async () => {
    const load = Object.values(inlines)[0];
    if (!load) throw new Error("mobile inline missing");
    mobileLoaded = true;
    return load();
});

const phoneOf = (device: Device): Phone => (device === "android" ? "android" : "iphone");

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

function MobileTwin({
    route,
    entry,
    example,
    values,
}: {
    route: PageRoute;
    entry: StoryEntry;
    example: StoryEntry["examples"][number];
    values?: Record<string, ControlValue> | undefined;
}) {
    const device = phoneOf(route.device);
    if (example.overlay === true) {
        // React Native sheets need a window of their own (and no StrictMode), so they get a frame.
        return (
            <iframe
                title={`${PHONE_LABEL[device]} ${example.title}`}
                src={`${import.meta.env.BASE_URL}${frameSrc(route.name, device, route.theme)}&example=${example.key}&only=1`}
                style={{ width: PHONE_WIDTH[device], height: 560 }}
                className="block border-0 bg-bg"
            />
        );
    }
    return (
        <Suspense fallback={null}>
            <MobileInline
                page={route.name}
                component={entry.component}
                example={example.key}
                device={device}
                values={values}
            />
        </Suspense>
    );
}

function Pair({ route, web, mobile }: { route: PageRoute; web: ReactNode; mobile: ReactNode }) {
    if (route.platform !== "compare") return <div className="relative min-h-16 p-4">{web}</div>;
    const device = phoneOf(route.device);
    return (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-h-16 min-w-0 p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Web
                </div>
                {web}
            </div>
            <div
                data-twin="mobile"
                className="min-w-0 overflow-x-auto border-t border-line-soft bg-bg lg:border-l lg:border-t-0"
            >
                <div className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {PHONE_LABEL[device]}
                </div>
                {mobile}
            </div>
        </div>
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
                        <div className="relative rounded-md border border-dashed border-line bg-bg">
                            <Pair
                                route={route}
                                web={
                                    <Rendered
                                        entry={entry}
                                        example={first}
                                        kit={webKit}
                                        ui={ui}
                                        values={values}
                                    />
                                }
                                mobile={
                                    <MobileTwin
                                        route={route}
                                        entry={entry}
                                        example={first}
                                        values={values}
                                    />
                                }
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
                    <Pair
                        route={route}
                        web={<Rendered entry={entry} example={ex} kit={webKit} ui={ui} />}
                        mobile={<MobileTwin route={route} entry={entry} example={ex} />}
                    />
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
    const compare = route.platform === "compare";
    return (
        <div className="flex flex-wrap items-end gap-3">
            <Choice
                label="View"
                layout="segmented"
                options={[
                    { key: "compare", label: "Side by side" },
                    { key: "web", label: "Web" },
                    { key: "mobile", label: "Phones" },
                ]}
                value={route.platform}
                onChange={(platform: Platform) => {
                    go(pageHash({ ...route, platform }));
                }}
            />
            {compare ? (
                <Choice
                    label="Device"
                    layout="segmented"
                    options={[
                        { key: "iphone", label: "iPhone" },
                        { key: "android", label: "Android" },
                    ]}
                    value={phoneOf(route.device)}
                    onChange={(device: Phone) => {
                        go(pageHash({ ...route, device }));
                    }}
                />
            ) : null}
            {route.platform === "mobile" ? (
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
            ) : null}
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
            <div className="grid gap-8">
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
                {route.platform === "mobile" ? <Phones route={route} values={values} /> : null}
            </div>
        </div>
    );
}

function Thumbnail({ entry }: { entry: StoryEntry }) {
    const first = entry.examples[0];
    if (!first) return null;
    return (
        <div inert className="pointer-events-none h-40 overflow-hidden bg-bg">
            <div className="w-[166%] origin-top-left scale-[0.6] p-5">
                <Rendered entry={entry} example={first} kit={webKit} ui={ui} />
            </div>
        </div>
    );
}

function Gallery({ theme }: { theme: ThemeKey }) {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const shown = PAGES.filter(
        (p) =>
            q === "" ||
            p.name.toLowerCase().includes(q) ||
            p.stories.some(
                (s) => s.component.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q),
            ),
    );
    return (
        <div className="space-y-6 px-8 py-8" data-page="gallery">
            <header className="space-y-3">
                <h1 className="font-display text-2xl font-bold text-ink">Gallery</h1>
                <p className="max-w-2xl text-sm text-muted">
                    Every component in @clientbridge/ui, drawn live on web. Open one to see it
                    beside its React Native twin on iPhone and Android.
                </p>
                <div className="max-w-md">
                    <SearchField
                        placeholder="Search components and summaries"
                        value={query}
                        onChange={setQuery}
                        size="lg"
                    />
                </div>
            </header>
            {shown.length === 0 ? (
                <p className="text-sm text-muted">No component matches “{query}”.</p>
            ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {shown.map((p) => (
                        <li key={p.name} data-gallery={p.name}>
                            <a
                                href={pageHash({ name: p.name, theme })}
                                className="block h-full overflow-hidden rounded-lg border border-line bg-surface shadow-card transition hover:border-accent-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                {p.stories[0] ? <Thumbnail entry={p.stories[0]} /> : null}
                                <span className="block border-t border-line-soft p-4">
                                    <span className="font-semibold text-ink">{p.name}</span>
                                    <span className="mt-1 block text-xs text-muted">
                                        {p.stories[0]?.summary}
                                    </span>
                                    <span className="mt-2 block text-xs text-muted">
                                        {p.stories.reduce((n, s) => n + s.examples.length, 0)}{" "}
                                        examples
                                    </span>
                                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function App({ route }: { route: Exclude<Route, { kind: "frame" }> }) {
    const [filter, setFilter] = useState("");
    useEffect(() => {
        document.documentElement.dataset.theme = route.theme;
        if (mobileLoaded && route.theme !== bootTheme) window.location.reload();
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
                <a
                    href={pageHash({ name: "", theme: route.theme })}
                    aria-current={route.kind === "index" ? "page" : undefined}
                    className={`mx-3 mb-3 block rounded-md px-3 py-1.5 text-sm ${route.kind === "index" ? "bg-accent-weak font-semibold text-accent" : "text-ink-soft hover:bg-bg"}`}
                >
                    Gallery
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
                    <Gallery theme={route.theme} />
                )}
            </main>
            <ConfirmHost />
        </div>
    );
}
