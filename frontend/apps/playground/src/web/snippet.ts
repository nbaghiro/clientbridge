import { isValidElement } from "react";

function attr(name: string, value: unknown): string | null {
    if (value === undefined) return null;
    if (value === true) return name;
    if (typeof value === "string") return `${name}=${JSON.stringify(value)}`;
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return `${name}={${String(value)}}`;
    }
    if (typeof value === "function") return `${name}={() => {}}`;
    if (isValidElement(value)) return `${name}={<…/>}`;
    const json = JSON.stringify(value);
    return `${name}={${json.length <= 60 ? json : "…"}}`;
}

// The import line and a JSX example for the props on screen, for pasting into a page.
export function snippet(component: string, props: Readonly<Record<string, unknown>>): string {
    const { children, ...rest } = props;
    const attrs = Object.entries(rest)
        .map(([k, v]) => attr(k, v))
        .filter((a): a is string => a !== null);
    const open =
        attrs.length > 2
            ? `<${component}\n    ${attrs.join("\n    ")}\n`
            : `<${component}${attrs.map((a) => ` ${a}`).join("")}`;
    const body =
        children === undefined
            ? `${open}${attrs.length > 2 ? "" : " "}/>`
            : `${open}>\n    ${typeof children === "string" ? children : "{…}"}\n</${component}>`;
    return `import { ${component} } from "@clientbridge/ui";\n\n${body}`;
}
