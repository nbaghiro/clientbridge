// Flags rendering a caught error's `message`: API messages are English developer text, so map the code instead.

const PASS_THROUGH = new Set([
    "ConditionalExpression",
    "LogicalExpression",
    "TemplateLiteral",
    "TSAsExpression",
    "TSNonNullExpression",
    "ChainExpression",
]);
const SINK_CALL = /^(set[A-Z]\w*|alert|toast|notify|show\w*)$/;
const SINK_PROPERTY = new Set(["error", "errorMessage", "message", "title", "body", "detail"]);

function isCaught(variable) {
    const def = variable?.defs[0];
    if (def === undefined) return false;
    if (def.type === "CatchClause") return true;
    if (def.type !== "Parameter" || def.node.params[0] !== def.name) return false;
    const call = def.node.parent;
    return (
        call?.type === "CallExpression" &&
        call.arguments.includes(def.node) &&
        call.callee.type === "MemberExpression" &&
        call.callee.property.type === "Identifier" &&
        (call.callee.property.name === "catch" ||
            (call.callee.property.name === "then" && call.arguments[1] === def.node))
    );
}

function sinkOf(node) {
    let child = node;
    for (let n = node.parent; n; child = n, n = n.parent) {
        if (n.type === "ConditionalExpression" && n.test === child) return null;
        if (PASS_THROUGH.has(n.type)) continue;
        if (n.type === "JSXExpressionContainer") return "JSX";
        if (n.type === "CallExpression" && n.arguments.includes(child)) {
            const callee = n.callee.type === "MemberExpression" ? n.callee.property : n.callee;
            return callee.type === "Identifier" && SINK_CALL.test(callee.name) ? `${callee.name}()` : null;
        }
        if (n.type === "Property" && n.value === child && n.key.type === "Identifier") {
            return SINK_PROPERTY.has(n.key.name) ? n.key.name : null;
        }
        return null;
    }
    return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: { description: "Disallow rendering the message of a caught error." },
        messages: {
            message: "A caught error's message reaches `{{sink}}`. Map it with failureMessage(e, fallback) from app-core.",
        },
        schema: [],
    },
    create(context) {
        return {
            'MemberExpression[property.name="message"]'(node) {
                if (node.object.type !== "Identifier") return;
                const scope = context.sourceCode.getScope(node);
                let variable = null;
                for (let s = scope; s && variable === null; s = s.upper) {
                    variable = s.set.get(node.object.name) ?? null;
                }
                if (!isCaught(variable)) return;
                const sink = sinkOf(node);
                if (sink !== null) context.report({ node, messageId: "message", data: { sink } });
            },
        };
    },
};
