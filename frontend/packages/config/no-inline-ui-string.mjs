// Custom ESLint rule: flag inline user-facing strings so copy stays in the shared catalog.
//
// Every user-facing string belongs in `packages/app-core/src/strings.ts` (see CLAUDE.md → Copy),
// rendered as `strings.<domain>.<key>`. This rule catches the two ways new copy sneaks back inline:
//   1. JSX text / string-literal children  — `<Text>Save</Text>`, `<p>{"Save"}</p>`
//   2. the app-core copy sinks             — `setError("…")`, `{ errorMessage: "…" }`
// It ignores anything without a letter (symbols, numbers, punctuation) and the `allow`-listed brand
// tokens (stripped word-by-word, so "PowerSync · offline" reads as symbol-only once the brand is removed).

const LETTER = /\p{L}/u;

/** True when, after removing allow-listed tokens, the trimmed text still contains a letter. */
function isCopy(raw, allow) {
    let text = String(raw).trim();
    if (text.length === 0) return false;
    for (const token of allow) text = text.split(token).join("");
    return LETTER.test(text);
}

/**
 * True when a string Literal lands in a JSX *child render position* — a direct `{"x"}` child, or a
 * branch of a `?:` / `||` / `??` that is rendered as a child (`{busy ? "Saving…" : "Save"}`). Walks up
 * through those transparent wrappers only; stops (returns false) at attributes, comparisons, call
 * args, object/array literals, etc. — so classNames, `status === "paid"` checks, and props are ignored.
 */
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
            jsx: "Inline UI string. Move this copy into the `strings` catalog (packages/app-core/src/strings.ts) and render `strings.<domain>.<key>`. See CLAUDE.md → Copy.",
            sink: "Inline UI string passed to `{{sink}}`. Move this copy into the `strings` catalog and reference `strings.<domain>.<key>`. See CLAUDE.md → Copy.",
        },
        schema: [
            {
                type: "object",
                properties: { allow: { type: "array", items: { type: "string" } } },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        const allow = context.options[0]?.allow ?? [];
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
            // String literal rendered as a JSX child — directly (`<X>{"copy"}</X>`) or via a `?:` / `||`
            // branch (`{busy ? "Saving…" : "Save"}`). Attributes and comparisons are excluded.
            Literal(node) {
                if (inJsxChildPosition(node)) flagJsx(node, node.value);
            },
            'CallExpression[callee.name="setError"] > Literal'(node) {
                flagSink(node, "setError()");
            },
            'Property[key.name="errorMessage"] > Literal'(node) {
                flagSink(node, "errorMessage");
            },
        };
    },
};
