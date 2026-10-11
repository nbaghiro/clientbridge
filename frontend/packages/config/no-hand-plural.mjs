// Flags `n === 1 ? "…" : "…"` and `n > 1 ? "…" : "…"` choices between texts, which hard-code English plural rules.
const EQUALITY = new Set(["===", "!==", "==", "!="]);
const ABOVE_ONE = { ">": 1, "<=": 1, ">=": 2, "<": 2 };

const COUNT =
    /(count|length|size|total|qty|quantity|amount|days|hours|minutes|weeks|months|years|items|visits|sessions|credits|uses|nights|people|seats|^n|num)$/i;

const nameOf = (node) =>
    node.type === "Identifier"
        ? node.name
        : node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
          ? node.property.name
          : node.type === "CallExpression"
            ? nameOf(node.callee)
            : "";

const isNumber = (node, n) => node.type === "Literal" && node.value === n;

const isOne = (node) =>
    (node.type === "Literal" && (node.value === 1 || node.value === -1)) ||
    (node.type === "UnaryExpression" && node.operator === "-" && isOne(node.argument));

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: { description: "Disallow choosing between texts with a count compared to one." },
        messages: {
            plural: "Hand-written plural. Use an ICU plural message, e.g. `{count, plural, one {# day} other {# days}}`.",
        },
        schema: [],
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        const checker = services.program.getTypeChecker();
        const isText = (node) => {
            const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
            const parts = type.isUnion() ? type.types : [type];
            return parts.every((t) => {
                if (t.isStringLiteral() || checker.typeToString(t) === "string") return true;
                return checker.getSignaturesOfType(t, 0).some((s) => {
                    const ret = checker.getReturnTypeOfSignature(s);
                    return ret.isStringLiteral() || checker.typeToString(ret) === "string";
                });
            });
        };
        return {
            ConditionalExpression(node) {
                const test = node.test;
                if (test.type !== "BinaryExpression") return;
                const bound = ABOVE_ONE[test.operator];
                const count = EQUALITY.has(test.operator)
                    ? isOne(test.right)
                        ? test.left
                        : isOne(test.left)
                          ? test.right
                          : null
                    : bound !== undefined && isNumber(test.right, bound)
                      ? test.left
                      : null;
                if (count === null || !COUNT.test(nameOf(count))) return;
                const literal = (n) => n.type === "Literal" && typeof n.value === "string";
                if (bound !== undefined && !(literal(node.consequent) && literal(node.alternate)))
                    return;
                if (isText(node.consequent) && isText(node.alternate)) {
                    context.report({ node, messageId: "plural" });
                }
            },
        };
    },
};
