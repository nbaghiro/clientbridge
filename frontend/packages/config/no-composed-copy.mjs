// Flags text composed in code (word order, punctuation and separators), which belongs in a catalog message.

const WORD = /(^|[\s(])\p{L}{2,}|\p{L}{2,}([\s,.!?)]|$)/u;
const SEPARATOR = /[·•–—…×*]|, |: |\. | \(|\) | \/ /;
const SQL = /\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|ORDER BY|GROUP BY|LIMIT|COALESCE|CASE\s+WHEN|WITH)\b|\b(datetime|strftime|julianday)\(/;
const CSS_FUNCTION = /\b(color-mix|repeat|minmax|calc|var|rgba?|hsla?|translate\w*|scale|rotate)\(|\d(px|rem|em|vh|vw|deg|ms)\b|^\s*\d*(px|rem|%)?\s+(solid|dashed|dotted)\b/;
const CLASS_TOKEN = /^!?[a-z][\w:]*-[\w/[\].%:-]*$/;
const MARKUP = /<\/?[a-z][\w:-]*[\s>/]|^[A-Z][A-Z-]*:/;
const COPY_NAMES = new Set([
    "aria-label",
    "title",
    "alt",
    "placeholder",
    "accessibilityLabel",
    "accessibilityHint",
    "label",
    "detail",
    "hint",
    "body",
    "subtitle",
    "description",
    "message",
    "caption",
    "heading",
    "meta",
    "summary",
    "text",
    "valueLabel",
]);
const CODE_NAME = /(sql|url|uri|href|src|srcset|path|route|key|id|class(name)?|style|query|token|slug|channel|selector|pattern|file(name)?|download)s?$/i;
const CODE_CALLS = new Set([
    "fetch",
    "URL",
    "Error",
    "RegExp",
    "matchMedia",
    "querySelector",
    "querySelectorAll",
    "getAll",
    "get",
    "getOptional",
    "execute",
    "watch",
    "useQuery",
    "post",
    "put",
    "patch",
    "del",
    "navigate",
    "push",
    "replace",
    "assign",
    "open",
    "openURL",
    "postMessage",
    "setItem",
    "getItem",
    "removeItem",
    "write",
    "log",
    "warn",
    "error",
    "info",
    "debug",
    "cx",
    "clsx",
    "cn",
]);
const PASS_THROUGH = new Set([
    "ConditionalExpression",
    "LogicalExpression",
    "TSAsExpression",
    "TSNonNullExpression",
    "AwaitExpression",
    "TemplateLiteral",
]);

function staticText(node) {
    if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? "").join("");
    if (node.type === "Literal" && typeof node.value === "string") return node.value;
    return null;
}

function nameOf(node) {
    if (node.type === "Identifier") return node.name;
    if (node.type === "Literal") return String(node.value);
    if (node.type === "MemberExpression" && !node.computed) return node.property.name;
    return null;
}

/** Where the composed value ends up: "copy" for a rendered place, "code" for a non-copy one, else null. */
function destination(node) {
    let child = node;
    for (let n = node.parent; n; child = n, n = n.parent) {
        if (n.type === "ConditionalExpression" && n.test === child) return "code";
        if (PASS_THROUGH.has(n.type)) continue;
        if (n.type === "ArrowFunctionExpression" && n.body === child) continue;
        if (n.type === "BinaryExpression") return n.operator === "+" ? null : "code";
        if (n.type === "JSXExpressionContainer") {
            if (n.parent.type !== "JSXAttribute") return "copy";
            return COPY_NAMES.has(String(n.parent.name.name)) ? "copy" : "code";
        }
        if (n.type === "CallExpression" || n.type === "NewExpression") {
            if (n.callee === child) return "code";
            const callee = nameOf(n.callee);
            return callee !== null && (CODE_CALLS.has(callee) || CODE_NAME.test(callee)) ? "code" : null;
        }
        if (n.type === "VariableDeclarator") return CODE_NAME.test(nameOf(n.id) ?? "") ? "code" : null;
        if (n.type === "AssignmentExpression") return CODE_NAME.test(nameOf(n.left) ?? "") ? "code" : null;
        if (n.type === "Property") {
            if (n.value !== child) return "code";
            const key = nameOf(n.key) ?? "";
            if (key.startsWith("--") || n.parent.parent?.parent?.name?.name === "style") return "code";
            if (COPY_NAMES.has(key)) return "copy";
            return CODE_NAME.test(key) ? "code" : null;
        }
        if (["ThrowStatement", "MemberExpression", "SwitchCase", "TaggedTemplateExpression"].includes(n.type)) {
            return "code";
        }
        return null;
    }
    return null;
}

function looksLikeCopy(text, where) {
    if (SQL.test(text) || MARKUP.test(text) || CSS_FUNCTION.test(text)) return false;
    const tokens = text.split(/\s+/).filter((t) => t !== "");
    const classes = tokens.filter((t) => CLASS_TOKEN.test(t)).length;
    if (classes > 0 && classes * 2 >= tokens.length) return false;
    if (where === "copy") return text !== "";
    if (!/\s/.test(text)) return false;
    return WORD.test(text) || SEPARATOR.test(text);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: { description: "Disallow composing UI text from parts in code." },
        messages: {
            composed: "Text composed in code. Put the sentence in a catalog message with arguments, or use formatParts or formatList.",
            join: "List joined with {{sep}}. Use formatList or formatParts from app-core.",
        },
        schema: [],
    },
    create(context) {
        const check = (node, text) => {
            const where = destination(node);
            if (where !== "code" && looksLikeCopy(text, where)) {
                context.report({ node, messageId: "composed" });
            }
        };
        return {
            TemplateLiteral(node) {
                if (node.expressions.length === 0) return;
                if (node.parent.type === "TaggedTemplateExpression") return;
                if (node.parent.type === "BinaryExpression" && node.parent.operator === "+") return;
                check(node, staticText(node));
            },
            BinaryExpression(node) {
                if (node.operator !== "+") return;
                if (node.parent.type === "BinaryExpression" && node.parent.operator === "+") return;
                const parts = [];
                const walk = (n) => {
                    if (n.type === "BinaryExpression" && n.operator === "+") {
                        walk(n.left);
                        walk(n.right);
                    } else {
                        parts.push(n);
                    }
                };
                walk(node);
                const texts = parts.map(staticText);
                if (texts.every((t) => t !== null) || texts.every((t) => t === null)) return;
                check(node, texts.filter((t) => t !== null).join(""));
            },
            'CallExpression[callee.property.name="join"]'(node) {
                const sep = node.arguments[0];
                if (sep?.type !== "Literal" || typeof sep.value !== "string") return;
                if (!SEPARATOR.test(sep.value) && !/\p{L}/u.test(sep.value)) return;
                if (destination(node) !== "code") {
                    context.report({ node, messageId: "join", data: { sep: JSON.stringify(sep.value) } });
                }
            },
        };
    },
};
