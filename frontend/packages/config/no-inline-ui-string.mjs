// Flags inline user-facing strings (JSX text and app-core error sinks) so copy stays in strings.ts.

const LETTER = /\p{L}/u;

/** True when, after removing allow-listed tokens, the trimmed text still contains a letter. */
function isCopy(raw, allow) {
    let text = String(raw).trim();
    if (text.length === 0) return false;
    for (const token of allow) text = text.split(token).join("");
    return LETTER.test(text);
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
            // A literal rendered as a JSX child, directly or through a ?: or || branch.
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
