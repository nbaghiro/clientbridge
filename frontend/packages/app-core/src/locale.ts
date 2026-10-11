import { IntlMessageFormat } from "intl-messageformat";

export type Locale = "en-CA" | "en-XA";
type Value = string | number | boolean;
type Catalog = Readonly<
    Record<string, { readonly message: string; readonly args?: readonly string[] }>
>;
type Node = Map<string, Node | string>;

interface Book {
    load: () => Promise<Catalog>;
    pseudo: Catalog | null;
    compiled: Map<string, IntlMessageFormat>;
}

const books: Book[] = [];
let pseudoOn = false;

export function activeLocale(): Locale {
    return pseudoOn ? "en-XA" : "en-CA";
}

/** Development and test switch to the generated en-XA pseudo-locale; never offered to users. */
export async function setPseudoLocale(on: boolean): Promise<void> {
    if (on) {
        await Promise.all(
            books.map(async (book) => {
                book.pseudo ??= await book.load();
            }),
        );
    }
    pseudoOn = on;
}

function isList(node: Node): boolean {
    return [...node.keys()].every((k, i) => k === String(i));
}

/** A catalog as nested groups whose leaves read the active locale each time they are used. */
export function catalog(source: Catalog, loadPseudo: () => Promise<Catalog>): unknown {
    const book: Book = { load: loadPseudo, pseudo: null, compiled: new Map() };
    books.push(book);

    const format = (key: string, values?: Record<string, Value | undefined>): string => {
        const locale = activeLocale();
        const id = `${locale}:${key}`;
        let message = book.compiled.get(id);
        if (message === undefined) {
            const text = ((pseudoOn ? book.pseudo : null) ?? source)[key]?.message ?? key;
            message = new IntlMessageFormat(text, locale, undefined, { ignoreTag: true });
            book.compiled.set(id, message);
        }
        return message.format(values) as string;
    };

    const leaf = (key: string): unknown => {
        const args = source[key]?.args;
        if (args === undefined) return format(key);
        return (...values: Value[]) =>
            format(key, Object.fromEntries(args.map((name, i) => [name, values[i]])));
    };

    const read = (node: Node | string): unknown => {
        if (typeof node === "string") return leaf(node);
        return isList(node) ? [...node.values()].map(read) : group(node);
    };

    const group = (node: Node): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [name, child] of node) {
            const live =
                typeof child === "string" ? source[child]?.args === undefined : isList(child);
            if (live) {
                Object.defineProperty(out, name, { enumerable: true, get: () => read(child) });
            } else {
                out[name] = read(child);
            }
        }
        return out;
    };

    const root: Node = new Map();
    for (const key of Object.keys(source)) {
        const path = key.split(".");
        const name = path.pop() ?? key;
        let node = root;
        for (const segment of path) {
            let next = node.get(segment);
            if (!(next instanceof Map)) {
                next = new Map();
                node.set(segment, next);
            }
            node = next;
        }
        node.set(name, key);
    }
    return group(root);
}
