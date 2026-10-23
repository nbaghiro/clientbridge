import { expect, it, vi } from "vitest";

import { afterReview, registerReviewHost, review } from "./previews";

const request = { title: "Check it", confirmLabel: "Send" };

it("answers no when nothing is mounted to ask", async () => {
    await expect(review(request)).resolves.toBeNull();
});

it("goes ahead only once the person chooses to", async () => {
    const go = vi.fn();
    const unregister = registerReviewHost(() => Promise.resolve(null));
    afterReview(request, go);
    await Promise.resolve();
    await Promise.resolve();
    expect(go).not.toHaveBeenCalled();
    unregister();
    const stop = registerReviewHost(() => Promise.resolve("alternate"));
    afterReview(request, go);
    await vi.waitFor(() => {
        expect(go).toHaveBeenCalledWith("alternate");
    });
    stop();
    await expect(review(request)).resolves.toBeNull();
});
