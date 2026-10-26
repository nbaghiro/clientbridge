import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);

export interface PhotoEvidence {
    id: string;
    business_id: string;
    parent_id: string;
    content_type: string;
    size: number;
    uploaded_at: string | null;
    storage: { size: number; sha256: string } | null;
}

export async function photoEvidence(clientId: string): Promise<PhotoEvidence[]> {
    const { stdout } = await execute("uv", ["run", "python", "-m", "scripts.e2e_files", clientId], {
        cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
        timeout: 30_000,
    });
    return JSON.parse(stdout) as PhotoEvidence[];
}

export async function portrait(): Promise<{
    buffer: Buffer;
    name: string;
    mimeType: string;
    sha256: string;
}> {
    const buffer = await readFile(
        new URL(
            "../../../../../backend/scripts/demo_assets/face_cl_regular_15.jpg",
            import.meta.url,
        ),
    );
    return {
        buffer,
        name: "Client portrait.jpg",
        mimeType: "image/jpeg",
        sha256: createHash("sha256").update(buffer).digest("hex"),
    };
}

export async function expectPhoto(editor: Locator, page: Page, sha256: string): Promise<string> {
    const image = editor
        .getByRole("button", { name: strings.files.changePhoto, exact: true })
        .locator("img");
    await expect(image).toBeVisible();
    await expect
        .poll(() =>
            image.evaluate(
                (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
            ),
        )
        .toBe(true);
    const source = await image.getAttribute("src");
    expect(source).not.toBeNull();
    const response = await page.request.get(source ?? "");
    expect(response.status()).toBe(200);
    expect(
        createHash("sha256")
            .update(await response.body())
            .digest("hex"),
    ).toBe(sha256);
    return source ?? "";
}

export function filesApi(): string {
    return runUrl("VITE_API_URL");
}
