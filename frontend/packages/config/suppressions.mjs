import ts from "typescript";

const LINE = String.raw`^\/\/\s*(eslint-disable|eslint-enable|@ts-ignore|@ts-nocheck|@ts-expect-error|prettier-ignore|istanbul\s+ignore|c8\s+ignore|biome-ignore|tslint:)`;
const BLOCK = String.raw`^\/\*\s*(eslint\b|globals?\s|@ts-|prettier-ignore|istanbul\s|c8\s|biome-ignore|tslint:)`;
const SUPPRESSION = new RegExp(`${LINE}|${BLOCK}`);

const commentsOf = (file, source) => {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
    const starts = new Set();
    const visit = (node) => {
        for (const ranges of [
            ts.getLeadingCommentRanges(source, node.pos),
            ts.getTrailingCommentRanges(source, node.end),
        ]) {
            for (const range of ranges ?? []) starts.add(range.pos);
        }
        for (const child of node.getChildren(sourceFile)) visit(child);
    };
    visit(sourceFile);
    return [...starts].sort((a, b) => a - b);
};

export const suppressionLines = (file, source) =>
    commentsOf(file, source)
        .filter((start) => SUPPRESSION.test(source.slice(start, start + 80)))
        .map((start) => source.slice(0, start).split("\n").length);
