// E2e files are named after the concept they cover, so a developer finds a test from the code they changed.
import { basename, dirname } from "node:path";

// Cross-cutting suites keep their own names, as the backend's test_flows_* do.
const CROSS_CUTTING = ["auth", "offline", "sync", "security", "shell", "accessibility", "pseudo"];
// The anchor flows whose consequences cross concepts, devices or the worker.
const JOURNEYS = [
    "visit",
    "estimate",
    "stock",
    "client",
    "documents",
    "communication",
    "entitlements",
    "team",
    "device",
    "operations",
];

// Connect's separate lanes, each with its own cases and helpers in its support/.
const CONNECT_LANES = new Set(["apps/connect/e2e/stripe", "apps/connect/e2e/smoke"]);

// concepts: app-core domains; publicPages: Connect pages; screens: screens with no domain of their own.
export function e2eNameProblems(files, { concepts, publicPages, screens, pageConcept }) {
    const problems = [];
    const check = (file, name, allowed, what) => {
        if (allowed.has(name)) return;
        const hint = name in pageConcept ? `; name it after its concept, ${pageConcept[name]}` : "";
        problems.push(`${file}: "${name}" is not ${what}${hint}`);
    };
    const web = new Set([...concepts, ...CROSS_CUTTING]);
    const connect = new Set([...publicPages, ...CROSS_CUTTING, "embed", "site"]);
    const mobile = new Set([...concepts, ...screens, ...CROSS_CUTTING]);
    const journeys = new Set(JOURNEYS);
    for (const file of files) {
        const dir = dirname(file);
        const name = basename(file);
        if (dir === "apps/web/e2e") {
            const spec = /^(.+)\.(e2e|filing)\.ts$/.exec(name);
            if (spec) check(file, spec[1], web, "an app-core domain or a cross-cutting suite");
            else if (name.endsWith(".journey.ts"))
                problems.push(`${file}: journeys live in apps/web/e2e/journeys/`);
            else if (name.endsWith(".ts"))
                problems.push(`${file}: helpers live in apps/web/e2e/support/`);
        } else if (dir === "apps/web/e2e/journeys") {
            const flow = /^(.+)\.journey\.ts$/.exec(name);
            if (flow) check(file, flow[1], journeys, `an anchor flow: ${JOURNEYS.join(", ")}`);
            else problems.push(`${file}: journeys/ holds only <flow>.journey.ts files`);
        } else if (dir === "apps/connect/e2e") {
            const spec = /^(.+)\.e2e\.ts$/.exec(name);
            if (spec) check(file, spec[1], connect, "a Connect page or a cross-cutting suite");
            else
                problems.push(
                    `${file}: apps/connect/e2e/ holds only <page>.e2e.ts files and support/`,
                );
        } else if (CONNECT_LANES.has(dir)) {
            const lane = dir.slice("apps/connect/e2e/".length);
            if (!name.endsWith(`.${lane}.ts`))
                problems.push(`${file}: ${dir}/ holds only <case>.${lane}.ts files and support/`);
        } else if (dir === "apps/mobile/e2e" && name.endsWith(".yaml")) {
            // a Maestro flow is one file, so a concept with several flows adds each one's aspect
            const concept = name.split(".")[0] ?? name;
            check(file, concept, mobile, "an app-core domain, a screen or a cross-cutting suite");
        }
    }
    return problems;
}
