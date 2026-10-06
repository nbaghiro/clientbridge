import { THEME_KEYS, type ThemeKey } from "@clientbridge/tokens";

export type Platform = "both" | "web" | "mobile";
export type Device = "both" | "iphone" | "android";

export type Route =
    | { kind: "index"; theme: ThemeKey }
    | {
          kind: "page";
          name: string;
          example: string | null;
          platform: Platform;
          device: Device;
          theme: ThemeKey;
      }
    | {
          kind: "frame";
          name: string;
          example: string | null;
          device: "iphone" | "android";
          theme: ThemeKey;
      };

const pick = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
    options.find((o) => o === value) ?? fallback;

export function parseHash(hash: string): Route {
    const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
    const q = new URLSearchParams(query);
    const theme = pick(q.get("theme"), THEME_KEYS, "pewter");
    const [first = "", second = ""] = path.split("/");
    if (first === "frame" && second !== "") {
        return {
            kind: "frame",
            name: second,
            example: q.get("example"),
            device: pick(q.get("device"), ["iphone", "android"] as const, "iphone"),
            theme,
        };
    }
    if (first === "") return { kind: "index", theme };
    return {
        kind: "page",
        name: first,
        example: second === "" ? null : second,
        platform: pick(q.get("platform"), ["both", "web", "mobile"] as const, "both"),
        device: pick(q.get("device"), ["both", "iphone", "android"] as const, "both"),
        theme,
    };
}

export function pageHash(r: {
    name: string;
    example?: string | null;
    platform?: Platform;
    device?: Device;
    theme?: ThemeKey;
}): string {
    const q = new URLSearchParams();
    if (r.platform !== undefined && r.platform !== "both") q.set("platform", r.platform);
    if (r.device !== undefined && r.device !== "both") q.set("device", r.device);
    if (r.theme !== undefined && r.theme !== "pewter") q.set("theme", r.theme);
    const tail = q.toString();
    return `#/${r.name}${r.example ? `/${r.example}` : ""}${tail ? `?${tail}` : ""}`;
}

export function frameSrc(name: string, device: "iphone" | "android", theme: ThemeKey): string {
    return `#/frame/${name}?device=${device}&theme=${theme}`;
}
