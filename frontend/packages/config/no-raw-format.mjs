// Flags locale formatting outside the formatter (app-core format.ts and datetime.ts).

const TO_LOCALE = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);
const LOCALE_TAG = /^[a-z]{2,3}-(?:[A-Z]{2}|\d{3})$/;

const isIntl = (node) =>
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "Intl";

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: { description: "Disallow formatting values outside the app-core formatter." },
        messages: {
            toLocale:
                "`{{name}}` formats in the device locale. Use the formatter in app-core format.ts or datetime.ts.",
            intl: "`Intl.{{name}}` belongs in the formatter (app-core format.ts or datetime.ts).",
            toFixed:
                "`toFixed` renders an English decimal. Use formatNumber, formatPercent or formatMoney.",
            tag: "Locale literal `{{tag}}`. Read the locale from activeLocale() through the formatter.",
        },
        schema: [],
    },
    create(context) {
        const checkIntl = (node) => {
            if (isIntl(node.callee)) {
                context.report({
                    node,
                    messageId: "intl",
                    data: { name: node.callee.property.name },
                });
            }
        };
        return {
            CallExpression(node) {
                checkIntl(node);
                const callee = node.callee;
                if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier")
                    return;
                const name = callee.property.name;
                if (TO_LOCALE.has(name))
                    context.report({ node, messageId: "toLocale", data: { name } });
                if (name === "toFixed") context.report({ node, messageId: "toFixed" });
            },
            NewExpression: checkIntl,
            Literal(node) {
                if (typeof node.value === "string" && LOCALE_TAG.test(node.value)) {
                    context.report({ node, messageId: "tag", data: { tag: node.value } });
                }
            },
        };
    },
};
