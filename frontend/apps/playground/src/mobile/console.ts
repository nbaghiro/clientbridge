/* eslint-disable no-console -- this file filters the console for the preview */
// react-native-web renders Pressable as a button, so a sheet with a pressable backdrop nests buttons.
const error = console.error.bind(console);
console.error = (...args: unknown[]): void => {
    if (
        typeof args[0] === "string" &&
        /cannot (be a descendant of|contain a nested)/.test(args[0]) &&
        args.includes("button")
    ) {
        return;
    }
    error(...args);
};

// react-native-web flags the shadow* props React Native still uses.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].includes('"shadow*" style props are deprecated')) {
        return;
    }
    warn(...args);
};
