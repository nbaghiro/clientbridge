const LOGO_PX = 512;

const notAPicture = (): Error =>
    Object.assign(new Error("the SVG could not be drawn"), { code: "file_type_unsupported" });

function pixels(value: string | null): number {
    return value !== null && /^[\d.]+(px)?$/.test(value.trim()) ? parseFloat(value) : NaN;
}

// A viewBox outranks width and height, which may be missing or in units a canvas can't use.
function drawnSize(svg: Element): { width: number; height: number } {
    const box = (svg.getAttribute("viewBox") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    const [boxWidth = NaN, boxHeight = NaN] = box.slice(2);
    const width = boxWidth > 0 ? boxWidth : pixels(svg.getAttribute("width"));
    const height = boxHeight > 0 ? boxHeight : pixels(svg.getAttribute("height"));
    return width > 0 && height > 0 ? { width, height } : { width: LOGO_PX, height: LOGO_PX };
}

function loaded(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            resolve(image);
        };
        image.onerror = () => {
            reject(notAPicture());
        };
        image.src = url;
    });
}

/** Draws an SVG logo to a PNG, since storage holds no format that can carry script. */
export async function pngFromSvg(file: File): Promise<Blob> {
    const parsed = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
    const svg = parsed.documentElement;
    if (svg.localName !== "svg" || parsed.querySelector("parsererror") !== null)
        throw notAPicture();
    const { width, height } = drawnSize(svg);
    const scale = LOGO_PX / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    // Firefox draws nothing for an SVG without its own size.
    if (!svg.hasAttribute("viewBox"))
        svg.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
    svg.setAttribute("width", String(canvas.width));
    svg.setAttribute("height", String(canvas.height));
    const sized = new Blob([new XMLSerializer().serializeToString(parsed)], {
        type: "image/svg+xml",
    });
    const url = URL.createObjectURL(sized);
    try {
        const image = await loaded(url);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => {
            try {
                canvas.toBlob((png) => {
                    if (png === null) reject(notAPicture());
                    else resolve(png);
                }, "image/png");
            } catch {
                // a canvas the browser considers tainted by the SVG refuses to export
                reject(notAPicture());
            }
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

export const isSvg = (file: File): boolean =>
    file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
