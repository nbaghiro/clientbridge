// Flags inline user-facing strings (JSX text, copy props, sinks and, with `literals`, any prose literal) so copy stays in the catalog.

const LETTER = /\p{L}/u;
const COPY_ATTRS = new Set(["aria-label", "title", "alt", "placeholder", "accessibilityLabel"]);
const DOM_TEXT = new Set(["textContent", "innerText", "title", "placeholder", "alt"]);
const COPY_NAME =
    /^(label|title|hint|detail|message|description|placeholder|text|heading|subtitle|caption|body|headerTitle|headerBackTitle|tabBarLabel|accessibilityHint|aria-(label|description|placeholder|roledescription|valuetext)|\w+(Label|Title|Text|Hint|Message|Placeholder|Heading|Caption))$/;
const CLASS_NAME = /^(class|className|\w+ClassName|style|fontFamily|preserveAspectRatio)$/;
// Keys of structured data and platform tables whose values are identifiers, not copy.
const DATA_KEYS = new Set(["@context", "@type", "applicationCategory", "operatingSystem", "name"]);
const KEY_NAMES = new Set([
    "Escape",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
]);
const WORD = /^[\p{L}][\p{L}'’-]*[.,!?:;…]?$/u;
const SQL =
    /\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|COALESCE|CASE|WHEN|AND|OR|IS NULL|ORDER BY|GROUP BY|PRAGMA|LIMIT)\b/;
const CLASS_TOKEN = /^[!-]?[a-z0-9@*_][a-z0-9\-:/.%_&>*@!()]*$/;

/** True when, after removing allow-listed tokens, the trimmed text still contains a letter. */
function isCopy(raw, allow) {
    let text = String(raw).trim();
    if (text.length === 0) return false;
    for (const token of allow) text = text.split(token).join("");
    return LETTER.test(text);
}

/** True when a text reads as prose: a capitalized word, or two words. */
function isProse(raw, allow) {
    let text = String(raw);
    for (const token of allow) text = text.split(token).join("");
    const words = text
        .trim()
        .split(/\s+/)
        .filter((w) => WORD.test(w) && w.length > 1);
    return words.some((w) => /^\p{Lu}\p{Ll}/u.test(w) && w.length > 2) || words.length >= 2;
}

/** True when a text is code: Tailwind classes, SQL, markup, CSS, a header or calendar line, a zone or a key name. */
function isCode(raw) {
    const text = String(raw).trim();
    if (SQL.test(text) || /^</.test(text) || /\{[^}]*:[^}]*\}/.test(text) || /^[A-Z-]+:/.test(text))
        return true;
    if (
        KEY_NAMES.has(text) ||
        /^[A-Z][a-z]+(\/[A-Za-z_]+)+$/.test(text) ||
        /^\/[\w\-/:?=&.]*$/.test(text)
    )
        return true;
    if (/_/.test(text) && text.split(/,\s*/).every((t) => /^[a-z_][a-z0-9_.]*$/.test(t)))
        return true;
    const tokens = text.split(/\s+/).map((t) => t.replace(/\[[^\]]*\]/g, "x"));
    return tokens.every((t) => CLASS_TOKEN.test(t)) && tokens.some((t) => /[-:/0-9]/.test(t));
}

const keyName = (key) =>
    key.type === "Identifier" ? key.name : typeof key.value === "string" ? key.value : null;

/** The prop, attribute or variable a literal is the value of, through ?:, ||, ??, arrays and templates. */
function ownerOf(node) {
    let child = node;
    for (let n = node.parent; n; child = n, n = n.parent) {
        if (n.type === "ConditionalExpression" && n.test === child) return { kind: "code" };
        if (n.type === "TSLiteralType") return { kind: "code" };
        if (
            [
                "ConditionalExpression",
                "LogicalExpression",
                "ArrayExpression",
                "TemplateLiteral",
            ].includes(n.type) ||
            n.type === "JSXExpressionContainer" ||
            ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"].includes(n.type)
        )
            continue;
        if (n.type === "JSXAttribute")
            return { kind: "attr", name: typeof n.name.name === "string" ? n.name.name : "" };
        if (n.type === "Property" && n.value === child) {
            const call = n.parent.parent;
            if (call?.type === "CallExpression" && call.callee.object?.name === "Platform")
                return { kind: "code" };
            if (
                n.parent.properties.some((p) => p.type === "Property" && keyName(p.key) === "@type")
            )
                return {
                    kind: DATA_KEYS.has(keyName(n.key)) ? "code" : "prop",
                    name: keyName(n.key),
                };
            return { kind: "prop", name: keyName(n.key) ?? "" };
        }
        if (n.type === "VariableDeclarator" && n.init === child)
            return { kind: "var", name: n.id.type === "Identifier" ? n.id.name : "" };
        if (n.type === "CallExpression" || n.type === "NewExpression") {
            if (!n.arguments.includes(child)) return { kind: "code" };
            const callee = n.callee.type === "MemberExpression" ? n.callee.property : n.callee;
            const name = callee.type === "Identifier" ? callee.name : "";
            if (n.type === "NewExpression" && /Error$/.test(name)) return { kind: "code" };
            if (/^(cx|clsx|cn|twMerge)$/.test(name)) return { kind: "attr", name: "className" };
            if (/^(navigate|push|popTo|replace|jumpTo)$/.test(name)) return { kind: "code" }; // route names
            if (n.callee.type === "MemberExpression" && n.callee.object.name === "Platform")
                return { kind: "code" };
            return { kind: "call", name };
        }
        if (
            n.type === "BinaryExpression" ||
            n.type === "SwitchCase" ||
            n.type === "ImportDeclaration" ||
            n.type === "ExportNamedDeclaration" ||
            n.type === "ExportAllDeclaration" ||
            n.type === "ImportExpression" ||
            n.type === "TaggedTemplateExpression" ||
            (n.type === "MemberExpression" && n.property === child) ||
            (n.type === "Property" && n.key === child) ||
            n.type === "JSXElement" ||
            n.type === "JSXFragment"
        )
            return { kind: "code" };
        return { kind: "value" };
    }
    return { kind: "value" };
}

/** True when a literal is rendered as a JSX child, directly or through ?:, || or ??. */
function inJsxChildPosition(node) {
    let child = node;
    let parent = node.parent;
    while (parent) {
        if (parent.type === "JSXExpressionContainer") {
            const host = parent.parent?.type;
            return host === "JSXElement" || host === "JSXFragment";
        }
        if (parent.type === "ConditionalExpression") {
            if (child === parent.test) return false; // the condition isn't rendered
        } else if (parent.type !== "LogicalExpression") {
            return false; // any other parent → not a rendered child
        }
        child = parent;
        parent = parent.parent;
    }
    return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallow inline user-facing strings; move copy into the shared `strings` catalog.",
        },
        messages: {
            attr: "Inline UI string in `{{attr}}`. Move this copy into the `strings` catalog and reference `strings.<domain>.<key>`. See CLAUDE.md → Copy.",
            jsx: "Inline UI string. Move this copy into the catalog (packages/app-core/locales/en-CA.json) and render `strings.<domain>.<key>`. See CLAUDE.md → Copy.",
            literal:
                "Inline UI string. Move this copy into the catalog (packages/app-core/locales/en-CA.json) and read `strings.<domain>.<key>`; identifiers belong in a string-literal union type. See CLAUDE.md → Copy.",
            sink: "Inline UI string passed to `{{sink}}`. Move this copy into the `strings` catalog and reference `strings.<domain>.<key>`. See CLAUDE.md → Copy.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    allow: { type: "array", items: { type: "string" } },
                    literals: { type: "boolean" },
                },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        const allow = context.options[0]?.allow ?? [];
        const services = context.sourceCode.parserServices;
        const checker = context.options[0]?.literals
            ? services?.program?.getTypeChecker()
            : undefined;
        // A literal checked against a union of string literals is an identifier (a variant, route or key), not copy.
        const isIdentifier = (node) => {
            const type = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node));
            if (type === undefined) return false;
            const parts = type.isUnion() ? type.types : [type];
            return parts.some((t) => t.isStringLiteral()) && parts.every((t) => !(t.flags & 4));
        };
        const checkLiteral = (node, text) => {
            if (checker === undefined || inJsxChildPosition(node) || isCode(text)) return;
            const owner = ownerOf(node);
            if (owner.kind === "code" || (owner.kind === "attr" && CLASS_NAME.test(owner.name)))
                return;
            const attribute =
                node.parent.type === "JSXExpressionContainer" ? node.parent.parent : node.parent;
            if (attribute.type === "JSXAttribute" && COPY_ATTRS.has(owner.name)) return; // reported by JSXAttribute
            if (CLASS_NAME.test(owner.name ?? "")) return;
            const named = owner.name !== undefined && COPY_NAME.test(owner.name);
            if (!(named ? isCopy(text, allow) : isProse(text, allow))) return;
            if (isIdentifier(node)) return;
            context.report({ node, messageId: "literal" });
        };
        const flagJsx = (node, value) => {
            if (typeof value === "string" && isCopy(value, allow)) {
                context.report({ node, messageId: "jsx" });
            }
        };
        const flagSink = (node, sink) => {
            if (typeof node.value === "string" && isCopy(node.value, allow)) {
                context.report({ node, messageId: "sink", data: { sink } });
            }
        };
        return {
            JSXText(node) {
                flagJsx(node, node.value);
            },
            // A literal rendered as a JSX child, directly or through a ?: or || branch.
            Literal(node) {
                if (inJsxChildPosition(node)) flagJsx(node, node.value);
                else if (typeof node.value === "string") checkLiteral(node, node.value);
            },
            TemplateLiteral(node) {
                if (node.parent.type === "TemplateLiteral") return;
                checkLiteral(node, node.quasis.map((q) => q.value.cooked).join(" "));
            },
            JSXAttribute(node) {
                const attr = node.name.name;
                if (typeof attr !== "string" || !COPY_ATTRS.has(attr) || node.value === null)
                    return;
                const value =
                    node.value.type === "JSXExpressionContainer"
                        ? node.value.expression
                        : node.value;
                const text =
                    value.type === "Literal"
                        ? value.value
                        : value.type === "TemplateLiteral"
                          ? value.quasis.map((q) => q.value.cooked).join("")
                          : null;
                if (typeof text === "string" && isCopy(text, allow)) {
                    context.report({ node, messageId: "attr", data: { attr } });
                }
            },
            'CallExpression[callee.name="setError"] > Literal'(node) {
                flagSink(node, "setError()");
            },
            'Property[key.name="errorMessage"] > Literal'(node) {
                flagSink(node, "errorMessage");
            },
            // The embed loader builds its DOM by hand, outside JSX.
            'AssignmentExpression[left.type="MemberExpression"] > Literal.right'(node) {
                const name = node.parent.left.property.name;
                if (DOM_TEXT.has(name)) flagSink(node, name);
            },
            'CallExpression[callee.property.name="setAttribute"] > Literal:nth-child(2)'(node) {
                const attr = node.parent.arguments[0];
                if (attr?.type === "Literal" && COPY_ATTRS.has(attr.value))
                    flagSink(node, attr.value);
            },
        };
    },
};
