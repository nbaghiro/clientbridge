// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import {
    industryOptions,
    setupTasks,
    useBookingSetupMissing,
    useBrandForm,
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

    it("sends the brand step to the brand section and offers to edit it once done", () => {
        const before = setupTasks(fresh).find((t) => t.key === "brand");
        expect(before?.target).toBe("brand");
        expect(before?.action).toBe(strings.business.getSetUp.tasks.brand.action);
        const after = setupTasks({ ...fresh, brand: JSON.stringify({ primary: "#2E4A3F" }) }).find(
            (t) => t.key === "brand",
        );
        expect(after?.action).toBe(strings.business.getSetUp.editBrand);
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

const ROW = {
    id: "bz_1",
    name: "Birch Studio",
    slug: "birch-studio",
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

describe("useBookingSetupMissing", () => {
    const owner = { staffId: "st_1", role: "owner" };

    it.each([
        ["before the replica answers", [], owner, false],
        ["when a service or hours are missing", [{ ready: 0 }], owner, true],
        ["once clients can book", [{ ready: 1 }], owner, false],
        ["to staff, who can't add them", [{ ready: 0 }], { staffId: "st_2", role: "staff" }, false],
        ["before the viewer is known", [{ ready: 0 }], null, false],
    ])("%s", (_when, rows, viewer, missing) => {
        replica.rows = rows;
        const { result } = renderHook(() => useBookingSetupMissing(viewer));
        expect(result.current).toBe(missing);
    });
});

describe("useBusinessForm", () => {
    it("lets another device's change through a field typed back to what is stored", () => {
        replica.rows = [ROW];
        const { api } = recordingApi(ROW);
        const { result, rerender } = renderHook(() => useBusinessForm(api));
        act(() => {
            result.current.set("city", "Nanaimo");
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.set("city", "Victoria");
        });
        expect(result.current.dirty).toBe(false);
        replica.rows = [{ ...ROW, city: "Sidney" }];
        rerender();
        expect(result.current.fields?.city).toBe("Sidney");
        expect(result.current.dirty).toBe(false);
    });

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
        expect(bodies).toEqual([{ name: "Birch & Co" }]);
    });

    it("explains a refused field, clears the reason on edit and reports unsaved edits", async () => {
        replica.rows = [ROW];
        const refused = Object.assign(new Error("422"), {
            code: "invalid_request",
            detail: [{ loc: ["body", "postal_code"] }, { loc: ["body", "billing_email"] }],
        });
        const api = { patch: () => Promise.reject(refused) } as unknown as ApiLike;
        const { result } = renderHook(() => useBusinessForm(api));
        await waitFor(() => {
            expect(result.current.fields).not.toBeNull();
        });
        expect(result.current.dirty).toBe(false);
        act(() => {
            result.current.set("postal_code", "12345");
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.business.checkFields);
        });
        expect(result.current.fieldErrors).toEqual({
            postal_code: strings.business.fieldErrors.postalCode,
            billing_email: strings.business.fieldErrors.email,
        });
        act(() => {
            result.current.set("postal_code", "V8W 1Y4");
        });
        expect(result.current.fieldErrors).toEqual({
            billing_email: strings.business.fieldErrors.email,
        });
    });

    it("follows a change synced from another device in a field not being edited", async () => {
        replica.rows = [ROW];
        const { api, bodies } = recordingApi(ROW);
        const { result, rerender } = renderHook(() => useBusinessForm(api));
        await waitFor(() => {
            expect(result.current.fields).not.toBeNull();
        });
        act(() => {
            result.current.set("city", "Sidney");
        });
        replica.rows = [{ ...ROW, name: "Renamed elsewhere" }];
        rerender();
        expect(result.current.fields?.name).toBe("Renamed elsewhere");
        expect(result.current.fields?.city).toBe("Sidney");
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(bodies).toHaveLength(1);
        });
        expect(bodies[0]).toEqual({ city: "Sidney" });
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

    it("types a slug as a subdomain and sends it only when it changed", async () => {
        replica.rows = [ROW];
        const { api, bodies } = recordingApi(ROW);
        const { result } = renderHook(() => useBusinessForm(api));
        await waitFor(() => {
            expect(result.current.fields).not.toBeNull();
        });
        expect(result.current.slugChanged).toBe(false);
        act(() => {
            result.current.set("slug", "Birch Bark ");
        });
        expect(result.current.fields?.slug).toBe("birch-bark-");
        expect(result.current.slugChanged).toBe(true);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.saved).toBe(true);
        });
        expect(bodies[0]).toMatchObject({ slug: "birch-bark" });
        act(() => {
            result.current.set("slug", "birch-studio");
        });
        expect(result.current.slugChanged).toBe(false);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(bodies).toHaveLength(2);
        });
        expect(Object.keys(bodies[1] ?? {})).not.toContain("slug");
    });
});

describe("useBrandForm", () => {
    const BRAND_ROW = {
        id: "bz_birch",
        name: "Birchbark",
        slug: "birch",
        province: "BC",
        brand: JSON.stringify({ primary: "#2E4A3F", tagline: "Old", website: "https://a.example" }),
    };

    function saving(answer: Record<string, unknown>) {
        const bodies: { brand: Record<string, unknown> }[] = [];
        const finish: (() => void)[] = [];
        const api = {
            patch: (_: string, body: { brand: Record<string, unknown> }) => {
                bodies.push(body);
                return new Promise((resolve) => {
                    finish.push(() => {
                        resolve({ brand: answer });
                    });
                });
            },
        } as unknown as ApiLike;
        return { api, bodies, finish };
    }

    it("keeps what was edited while an upload ran, whichever finishes first", () => {
        replica.rows = [BRAND_ROW];
        const { api } = saving({});
        const { result } = renderHook(() => useBrandForm(api));
        const whenTheUploadStarted = result.current;
        act(() => {
            result.current.setTagline("Typed during the upload");
        });
        act(() => {
            result.current.setColour("#7D5A82");
        });
        act(() => {
            whenTheUploadStarted.setLogoFileId("fl_logo");
        });
        act(() => {
            whenTheUploadStarted.setCoverFileId("fl_cover");
        });
        expect(result.current.tagline).toBe("Typed during the upload");
        expect(result.current.colour).toBe("#7D5A82");
        expect(result.current.logoFileId).toBe("fl_logo");
        expect(result.current.coverFileId).toBe("fl_cover");
    });

    it("lets another device's change through fields typed back to what is stored", () => {
        const stored = {
            primary: "#2E4A3F",
            tagline: "Old",
            website: "https://a.example",
            public_staff_ids: ["st_a"],
        };
        replica.rows = [{ ...BRAND_ROW, brand: JSON.stringify(stored) }];
        const { api } = saving({});
        const { result, rerender } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setTagline("Typed");
            result.current.setProfile("website", "https://typed.example");
            result.current.setPublicTeam("st_b", true);
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.setTagline("Old");
            result.current.setProfile("website", "https://a.example");
            result.current.setPublicTeam("st_b", false);
        });
        expect(result.current.dirty).toBe(false);
        replica.rows = [
            {
                ...BRAND_ROW,
                brand: JSON.stringify({
                    ...stored,
                    tagline: "Newer",
                    website: "https://b.example",
                    public_staff_ids: ["st_a", "st_c"],
                }),
            },
        ];
        rerender();
        expect(result.current.tagline).toBe("Newer");
        expect(result.current.profile.website).toBe("https://b.example");
        expect(result.current.dirty).toBe(false);
    });

    it("sends only what changed, so what another device saved stays", async () => {
        replica.rows = [BRAND_ROW];
        const { api, bodies, finish } = saving({});
        const { result, rerender } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setTagline("New");
        });
        replica.rows = [
            {
                ...BRAND_ROW,
                brand: JSON.stringify({
                    primary: "#A95C43",
                    tagline: "Old",
                    website: "https://b.example",
                }),
            },
        ];
        rerender();
        expect(result.current.colour).toBe("#A95C43");
        expect(result.current.profile.website).toBe("https://b.example");
        act(() => {
            result.current.submit();
        });
        expect(bodies).toEqual([{ brand: { tagline: "New" } }]);
        await act(async () => {
            finish[0]?.();
            await Promise.resolve();
        });
    });

    it("shows what was saved until it syncs back, then follows the replica", async () => {
        replica.rows = [BRAND_ROW];
        const { api, finish } = saving({ primary: "#2E4A3F", tagline: "New" });
        const { result, rerender } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setTagline("New");
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.submit();
        });
        act(() => {
            finish[0]?.();
        });
        await waitFor(() => {
            expect(result.current.saved).toBe(true);
        });
        expect(result.current.tagline).toBe("New");
        expect(result.current.dirty).toBe(false);
        replica.rows = [
            { ...BRAND_ROW, brand: JSON.stringify({ primary: "#2E4A3F", tagline: "Later" }) },
        ];
        rerender();
        await waitFor(() => {
            expect(result.current.tagline).toBe("Later");
        });
    });

    it("keeps an edit made while the save was on its way", async () => {
        replica.rows = [BRAND_ROW];
        const { api, finish } = saving({ primary: "#2E4A3F", tagline: "First" });
        const { result } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setTagline("First");
        });
        act(() => {
            result.current.submit();
        });
        act(() => {
            result.current.setTagline("Second");
        });
        act(() => {
            finish[0]?.();
        });
        await waitFor(() => {
            expect(result.current.saved).toBe(true);
        });
        expect(result.current.tagline).toBe("Second");
        expect(result.current.dirty).toBe(true);
    });

    it("saves the suggested colour when none was ever chosen", () => {
        replica.rows = [{ ...BRAND_ROW, brand: null }];
        const { api, bodies } = saving({});
        const { result } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.submit();
        });
        expect(bodies[0]?.brand.primary).toBe(result.current.colour);
    });

    it("removes the logo by sending null", () => {
        replica.rows = [
            { ...BRAND_ROW, brand: JSON.stringify({ primary: "#2E4A3F", logo_file_id: "fl_a" }) },
        ];
        const { api, bodies } = saving({});
        const { result } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setLogoFileId("");
        });
        act(() => {
            result.current.submit();
        });
        expect(bodies).toEqual([{ brand: { logo_file_id: null } }]);
    });

    it.each([
        ["fl_b", "fl_b"],
        ["", null],
    ])("saves the cover as %j by file id, sending %j", (id, sent) => {
        replica.rows = [
            { ...BRAND_ROW, brand: JSON.stringify({ primary: "#2E4A3F", cover_file_id: "fl_a" }) },
        ];
        const { api, bodies } = saving({});
        const { result } = renderHook(() => useBrandForm(api));
        expect(result.current.coverFileId).toBe("fl_a");
        act(() => {
            result.current.setCoverFileId(id);
        });
        act(() => {
            result.current.submit();
        });
        expect(bodies).toEqual([{ brand: { cover_file_id: sent } }]);
    });

    it("sends the gallery as a list and pickup numbers as numbers", () => {
        replica.rows = [BRAND_ROW];
        const { api, bodies } = saving({});
        const { result } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setProfile(
                "gallery_urls",
                " https://a.example/1.jpg \n\nhttps://a.example/2.jpg",
            );
        });
        act(() => {
            result.current.setProfile("pickup_capacity", "4");
        });
        act(() => {
            result.current.submit();
        });
        expect(bodies).toEqual([
            {
                brand: {
                    gallery_urls: ["https://a.example/1.jpg", "https://a.example/2.jpg"],
                    pickup_capacity: 4,
                },
            },
        ]);
    });

    it("explains a refused brand field and clears the reason on edit", async () => {
        replica.rows = [BRAND_ROW];
        const refused = Object.assign(new Error("422"), {
            code: "invalid_request",
            detail: [{ loc: ["body", "brand", "website"] }],
        });
        const api = { patch: () => Promise.reject(refused) } as unknown as ApiLike;
        const { result } = renderHook(() => useBrandForm(api));
        act(() => {
            result.current.setProfile("website", "not a link");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.business.checkFields);
        });
        expect(result.current.fieldErrors.website).toBe(strings.business.fieldErrors.website);
        act(() => {
            result.current.setProfile("website", "https://a.example");
        });
        expect(result.current.fieldErrors.website).toBeUndefined();
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

    it("says why the server refused the web address", async () => {
        const reserved = Object.assign(new Error("422"), { code: "slug_reserved" });
        const api = { post: () => Promise.reject(reserved) } as unknown as ApiLike;
        const { result } = renderHook(() => useOnboardingForm(api, vi.fn()));
        act(() => {
            result.current.setName("Birch Studio");
            result.current.setProvince("BC");
            result.current.setIndustry("petCare");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.busy).toBe(false);
        });
        expect(result.current.error).toBe(strings.api.slugReserved);
    });

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
        expect(result.current.error).toBeNull();
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

    it("sends student as the subject kind for a driving school", async () => {
        const { api, posted } = recordingPost();
        const created = vi.fn();
        const { result } = renderHook(() => useOnboardingForm(api, created));
        act(() => {
            result.current.setName("Lakeshore Driving");
            result.current.setProvince("ON");
            result.current.setIndustry("drivingSchool");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(created).toHaveBeenCalled();
        });
        expect(posted).toMatchObject([{ subject: "student" }]);
    });

    it("lists each industry with its catalog label", () => {
        const options = industryOptions();
        expect(options).toHaveLength(14);
        expect(options).toContainEqual({ key: "detailing", label: "Mobile car detailing" });
        expect(options).toContainEqual({ key: "drivingSchool", label: "Driving school" });
        expect(options[0]).toEqual({ key: "petGrooming", label: "Pet grooming and daycare" });
        expect(options.at(-1)).toEqual({ key: "other", label: "Something else" });
    });
});
