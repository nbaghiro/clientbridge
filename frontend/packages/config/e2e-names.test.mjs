import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { e2eNameProblems } from "./e2e-names.mjs";

const names = {
    concepts: new Set(["billing", "clients", "pos", "today"]),
    publicPages: new Set(["publicBooking", "publicShop"]),
    screens: new Set(["setup"]),
    pageConcept: { invoices: "billing" },
};
const problems = (...files) => e2eNameProblems(files, names);

describe("e2e file names", () => {
    it("accepts concepts, cross-cutting suites, anchor flows and helpers in support/", () => {
        assert.deepEqual(
            problems(
                "apps/web/e2e/billing.e2e.ts",
                "apps/web/e2e/shell.e2e.ts",
                "apps/web/e2e/clients.filing.ts",
                "apps/web/e2e/journeys/visit.journey.ts",
                "apps/web/e2e/support/anything.ts",
                "apps/connect/e2e/publicShop.e2e.ts",
                "apps/connect/e2e/embed.e2e.ts",
                "apps/connect/e2e/hosts.ts",
                "apps/connect/e2e/stripe-provider.spec.ts",
                "apps/mobile/e2e/today.yaml",
                "apps/mobile/e2e/setup.yaml",
                "apps/mobile/e2e/auth.recovery.yaml",
                "apps/mobile/e2e/shards.json",
                "apps/mobile/e2e/helpers/owner.yaml",
            ),
            [],
        );
    });

    it("points a page label at its concept", () => {
        assert.deepEqual(problems("apps/web/e2e/invoices.e2e.ts"), [
            'apps/web/e2e/invoices.e2e.ts: "invoices" is not an app-core domain or a cross-cutting suite; name it after its concept, billing',
        ]);
    });

    it("rejects names that are no concept, flow or page", () => {
        assert.equal(
            problems(
                "apps/web/e2e/crm.e2e.ts",
                "apps/web/e2e/journeys/scheduling.journey.ts",
                "apps/connect/e2e/connect.e2e.ts",
                "apps/connect/e2e/deposit.spec.ts",
                "apps/mobile/e2e/01-workday.yaml",
            ).length,
            5,
        );
    });

    it("keeps journeys in journeys/ and helpers in support/", () => {
        assert.deepEqual(problems("apps/web/e2e/visit.journey.ts", "apps/web/e2e/identity.ts"), [
            "apps/web/e2e/visit.journey.ts: journeys live in apps/web/e2e/journeys/",
            "apps/web/e2e/identity.ts: helpers live in apps/web/e2e/support/",
        ]);
    });
});
