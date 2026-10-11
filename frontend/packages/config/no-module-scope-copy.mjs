// Flags catalog text read while a module loads, which would keep the locale active at import time.

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function atModuleScope(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (FUNCTION.has(n.type)) return false;
        if (n.type === "PropertyDefinition" && !n.static) return false;
    }
    return true;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
    meta: {
        type: "problem",
        docs: { description: "Disallow reading catalog text at module scope." },
        messages: {
            read: "Catalog text read at module scope stays in the locale active at import. Read it inside a function or getter.",
        },
        schema: [],
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        const checker = services.program.getTypeChecker();
        const fromCatalog = (node) => {
            const ts = services.esTreeNodeToTSNodeMap.get(node);
            const symbol = checker.getSymbolAtLocation(ts.name ?? ts);
            return (symbol?.declarations ?? []).some((d) =>
                /[\\/]src[\\/]strings\.ts$/.test(d.getSourceFile().fileName),
            );
        };
        const isText = (node) => {
            const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
            return /^(string|readonly string\[\]|readonly \[string)/.test(checker.typeToString(type));
        };
        return {
            MemberExpression(node) {
                const called = node.parent.type === "CallExpression" && node.parent.callee === node;
                if (!called && !isText(node)) return;
                if (!fromCatalog(node.computed ? node.object : node.property)) return;
                if (atModuleScope(node)) context.report({ node, messageId: "read" });
            },
        };
    },
};
