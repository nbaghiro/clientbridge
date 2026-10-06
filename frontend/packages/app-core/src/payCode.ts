// Draws a scannable-looking module grid seeded from the value; the server draws the real QR on the PDF.
export function payCodeMatrix(value: string, size = 25): boolean[][] {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    const next = (): number => {
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        return (h >>> 0) / 4294967296;
    };
    const corners = [
        [0, 0],
        [0, size - 7],
        [size - 7, 0],
    ] as const;
    const finder = (r: number, c: number): boolean | null => {
        for (const [fr, fc] of corners) {
            if (r >= fr - 1 && r <= fr + 7 && c >= fc - 1 && c <= fc + 7) {
                const y = r - fr;
                const x = c - fc;
                if (y < 0 || y > 6 || x < 0 || x > 6) return false;
                return (
                    y === 0 ||
                    y === 6 ||
                    x === 0 ||
                    x === 6 ||
                    (y >= 2 && y <= 4 && x >= 2 && x <= 4)
                );
            }
        }
        return null;
    };
    return Array.from({ length: size }, (_, r) =>
        Array.from(
            { length: size },
            (_, c) => finder(r, c) ?? (r === 6 || c === 6 ? (r + c) % 2 === 0 : next() > 0.52),
        ),
    );
}
