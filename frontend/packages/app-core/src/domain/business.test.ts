// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import {
    bookingPageUrl,
    industryOptions,
    setupTasks,
    useBusinessForm,
    useOnboardingForm,
} from "./business";

const replica = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: replica.rows }),
}));

type Counts = Parameters<typeof setupTasks>[0];

const fresh: Counts = {
    services: 0,
    hours: 0,
    team: 1,
    stripe: 0,
    slug: "birch",
    name: "Birchbark",
    brand: null,
    province: "BC",
    tax_registered: 0,
    pst_number: null,
    dismissed_at: null,
    classes: 0,
    invites: null,
};

describe("setupTasks", () => {
    it("starts a new business with only the business step done", () => {
        const tasks = setupTasks(fresh);
        expect(tasks.map((t) => t.key)).toEqual([
            "business",
            "services",
            "hours",
            "brand",
            "stripe",
            "team",
            "tax",
        ]);
        expect(tasks.filter((t) => t.done).map((t) => t.key)).toEqual(["business"]);
        expect(tasks[0]?.hint).toBe("Birchbark, British Columbia");
    });

    it("marks each step done from the synced counts", () => {
        const tasks = setupTasks({
            ...fresh,
            services: 3,
            classes: 1,
            hours: 5,
            team: 2,
            stripe: 1,
            brand: JSON.stringify({ primary: "#2E4A3F" }),
            tax_registered: 1,
            pst_number: "PST-1234-5678",
            invites: "amy@birch.test, ben@birch.test",
        });
        expect(tasks.every((t) => t.done)).toBe(true);
        expect(tasks.find((t) => t.key === "services")?.hint).toBe("2 services and 1 class");
        expect(tasks.find((t) => t.key === "team")?.hint).toBe("2 invites waiting");
    });

    it("counts a logo alone as a brand", () => {
        const tasks = setupTasks({ ...fresh, brand: JSON.stringify({ logo_file_id: "fl_1" }) });
        expect(tasks.find((t) => t.key === "brand")?.done).toBe(true);
    });
});

describe("bookingPageUrl", () => {
    it("joins the Connect host and the slug without a doubled slash", () => {
        expect(bookingPageUrl("https://book.example.ca/", "birch")).toBe(
            "https://book.example.ca/b/birch/book",
        );
    });
});

const ROW = {
    id: "bz_1",
    name: "Birch Studio",
    timezone: "America/Vancouver",
    billing_email: null,
    gst_hst_number: null,
    qst_number: null,
    province: "BC",
    unit: null,
    street_number: "1207",
    street_name: "Government Street",
    city: "Victoria",
    postal_code: "V8W 1Y9",
    legal_phone: null,
    brand: null,
};

function recordingApi(reply: object): { api: ApiLike; bodies: Record<string, unknown>[] } {
    const bodies: Record<string, unknown>[] = [];
    const patch = (_path: string, body: unknown) => {
        bodies.push(body as Record<string, unknown>);
        return Promise.resolve(reply);
    };
    return { api: { patch } as unknown as ApiLike, bodies };
}

describe("useBusinessForm", () => {
    it("leaves the address out of a save that did not touch it", async () => {
        replica.rows = [ROW];
        const { api, bodies } = recordingApi(ROW);
        const { result } = renderHook(() => useBusinessForm(api));
        await waitFor(() => {
            expect(result.current.fields).not.toBeNull();
        });
        act(() => {
            result.current.set("name", "Birch & Co");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.saved).toBe(true);
        });
        expect(bodies).toEqual([
            {
                name: "Birch & Co",
                timezone: "America/Vancouver",
                billing_email: "",
            },
        ]);
    });

    it("sends only the changed address field and shows the value the server stored", async () => {
        replica.rows = [ROW];
        const { api, bodies } = recordingApi({ ...ROW, postal_code: "V8W 1Y4" });
        const { result } = renderHook(() => useBusinessForm(api));
        await waitFor(() => {
            expect(result.current.fields).not.toBeNull();
        });
        act(() => {
            result.current.set("postal_code", "v8w1y4");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.fields?.postal_code).toBe("V8W 1Y4");
        });
        expect(bodies[0]).toMatchObject({ postal_code: "v8w1y4" });
        expect(Object.keys(bodies[0] ?? {})).not.toContain("city");
    });
});

describe("useOnboardingForm", () => {
    function recordingPost(): { api: ApiLike; posted: unknown[] } {
        const posted: unknown[] = [];
        const post = (_path: string, body: unknown) => {
            posted.push(body);
            return Promise.resolve({ id: "bz_new" });
        };
        return { api: { post } as unknown as ApiLike, posted };
    }

    it("starts with no province and will not create a business until one is chosen", async () => {
        const { api, posted } = recordingPost();
        const created = vi.fn();
        const { result } = renderHook(() => useOnboardingForm(api, created));
        expect(result.current.province).toBeNull();
        expect(result.current.taxSummary).toBeNull();
        act(() => {
            result.current.setName("Birch Studio");
            result.current.setIndustry("petCare");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe("Choose the province or territory where the business is");
        expect(posted).toEqual([]);
        act(() => {
            result.current.setProvince("BC");
        });
        expect(result.current.taxSummary).toBe("GST 5% + PST 7%");
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(created).toHaveBeenCalled();
        });
        expect(posted).toEqual([
            {
                name: "Birch Studio",
                slug: "birch-studio",
                province: "BC",
                subject: "pet",
                timezone: null,
            },
        ]);
    });

    it("requires an industry and sends the subject kind it maps to", async () => {
        const { api, posted } = recordingPost();
        const created = vi.fn();
        const { result } = renderHook(() => useOnboardingForm(api, created));
        act(() => {
            result.current.setName("Fern Hair");
            result.current.setProvince("ON");
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe("Choose your industry.");
        expect(posted).toEqual([]);
        act(() => {
            result.current.setIndustry("beauty");
        });
        expect(result.current.error).toBeNull();
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(created).toHaveBeenCalled();
        });
        expect(posted).toMatchObject([{ subject: null }]);
    });

    it("sends vehicle as the subject kind for mobile car detailing", async () => {
        const { api, posted } = recordingPost();
        const created = vi.fn();
        const { result } = renderHook(() => useOnboardingForm(api, created));
        act(() => {
            result.current.setName("Shine Mobile");
            result.current.setProvince("BC");
            result.current.setIndustry("detailing");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(created).toHaveBeenCalled();
        });
        expect(posted).toMatchObject([{ subject: "vehicle" }]);
    });

    it("lists each industry with its catalog label", () => {
        const options = industryOptions();
        expect(options).toHaveLength(13);
        expect(options).toContainEqual({ key: "detailing", label: "Mobile car detailing" });
        expect(options[0]).toEqual({ key: "petGrooming", label: "Pet grooming and daycare" });
        expect(options.at(-1)).toEqual({ key: "other", label: "Something else" });
    });
});
