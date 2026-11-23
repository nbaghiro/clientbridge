// A real QR code (ISO/IEC 18004) in byte mode at error-correction level M, without its quiet zone.
const ECC_PER_BLOCK = [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS = [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
const LEVEL_M_FORMAT = 0;

// The blank margin, in modules, that the standard asks for around the symbol.
export const PAY_CODE_QUIET_ZONE = 4;

function bit(value: number, index: number): boolean {
    return ((value >>> index) & 1) !== 0;
}

function rawModules(version: number): number {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const align = Math.floor(version / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (version >= 7) result -= 36;
    }
    return result;
}

function dataCodewords(version: number): number {
    const blocks = BLOCKS[version - 1] ?? 0;
    return Math.floor(rawModules(version) / 8) - (ECC_PER_BLOCK[version - 1] ?? 0) * blocks;
}

function gfMultiply(x: number, y: number): number {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

function divisor(degree: number): number[] {
    const result = Array<number>(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < degree; j += 1) {
            result[j] = gfMultiply(result[j] ?? 0, root) ^ (result[j + 1] ?? 0);
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}

function remainder(data: readonly number[], div: readonly number[]): number[] {
    const result = div.map(() => 0);
    for (const byte of data) {
        const factor = byte ^ (result.shift() ?? 0);
        result.push(0);
        div.forEach((coefficient, i) => {
            result[i] = (result[i] ?? 0) ^ gfMultiply(coefficient, factor);
        });
    }
    return result;
}

function codewords(bytes: readonly number[]): { version: number; data: number[] } {
    for (let version = 1; version <= 40; version += 1) {
        const countBits = version < 10 ? 8 : 16;
        const capacity = dataCodewords(version) * 8;
        if (4 + countBits + bytes.length * 8 > capacity) continue;
        const bits: boolean[] = [];
        const append = (value: number, length: number): void => {
            for (let i = length - 1; i >= 0; i -= 1) bits.push(bit(value, i));
        };
        append(0b0100, 4);
        append(bytes.length, countBits);
        bytes.forEach((byte) => {
            append(byte, 8);
        });
        append(0, Math.min(4, capacity - bits.length));
        append(0, (8 - (bits.length % 8)) % 8);
        const data: number[] = [];
        for (let i = 0; i < bits.length; i += 8)
            data.push(bits.slice(i, i + 8).reduce((byte, on) => (byte << 1) | (on ? 1 : 0), 0));
        for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);
        return { version, data };
    }
    throw new RangeError("too long for a QR code");
}

function withErrorCorrection(version: number, data: readonly number[]): number[] {
    const blocks = BLOCKS[version - 1] ?? 1;
    const eccLength = ECC_PER_BLOCK[version - 1] ?? 0;
    const raw = Math.floor(rawModules(version) / 8);
    const shortBlocks = blocks - (raw % blocks);
    const shortLength = Math.floor(raw / blocks);
    const div = divisor(eccLength);
    const filled: number[][] = [];
    for (let i = 0, k = 0; i < blocks; i += 1) {
        const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
        k += block.length;
        const ecc = remainder(block, div);
        if (i < shortBlocks) block.push(0);
        filled.push([...block, ...ecc]);
    }
    const result: number[] = [];
    for (let i = 0; i < shortLength + 1; i += 1)
        filled.forEach((block, j) => {
            if (i !== shortLength - eccLength || j >= shortBlocks) {
                const value = block[i];
                if (value !== undefined) result.push(value);
            }
        });
    return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
    readonly version: number;
    readonly size: number;
    readonly modules: boolean[][];
    private readonly reserved: boolean[][];

    constructor(version: number) {
        this.version = version;
        this.size = version * 4 + 17;
        this.modules = Array.from({ length: this.size }, () =>
            Array<boolean>(this.size).fill(false),
        );
        this.reserved = Array.from({ length: this.size }, () =>
            Array<boolean>(this.size).fill(false),
        );
    }

    get(x: number, y: number): boolean {
        return this.modules[y]?.[x] ?? false;
    }

    private fixed(x: number, y: number, dark: boolean): void {
        const row = this.modules[y];
        const lock = this.reserved[y];
        if (row === undefined || lock === undefined || x < 0 || x >= this.size) return;
        row[x] = dark;
        lock[x] = true;
    }

    private isReserved(x: number, y: number): boolean {
        return this.reserved[y]?.[x] ?? true;
    }

    drawPatterns(): void {
        for (let i = 0; i < this.size; i += 1) {
            this.fixed(6, i, i % 2 === 0);
            this.fixed(i, 6, i % 2 === 0);
        }
        for (const [cx, cy] of [
            [3, 3],
            [this.size - 4, 3],
            [3, this.size - 4],
        ] as const) {
            for (let dy = -4; dy <= 4; dy += 1)
                for (let dx = -4; dx <= 4; dx += 1) {
                    const distance = Math.max(Math.abs(dx), Math.abs(dy));
                    this.fixed(cx + dx, cy + dy, distance !== 2 && distance !== 4);
                }
        }
        const centres = this.alignmentCentres();
        const last = centres.length - 1;
        centres.forEach((cy, i) => {
            centres.forEach((cx, j) => {
                if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))
                    return;
                for (let dy = -2; dy <= 2; dy += 1)
                    for (let dx = -2; dx <= 2; dx += 1)
                        this.fixed(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            });
        });
        this.drawFormat(0);
        if (this.version >= 7) {
            let rem = this.version;
            for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const bits = (this.version << 12) | rem;
            for (let i = 0; i < 18; i += 1) {
                const a = this.size - 11 + (i % 3);
                const b = Math.floor(i / 3);
                this.fixed(a, b, bit(bits, i));
                this.fixed(b, a, bit(bits, i));
            }
        }
    }

    private alignmentCentres(): number[] {
        if (this.version === 1) return [];
        const count = Math.floor(this.version / 7) + 2;
        const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
        const result = [6];
        for (let at = this.size - 7; result.length < count; at -= step) result.splice(1, 0, at);
        return result;
    }

    drawFormat(mask: number): void {
        const data = (LEVEL_M_FORMAT << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        for (let i = 0; i <= 5; i += 1) this.fixed(8, i, bit(bits, i));
        this.fixed(8, 7, bit(bits, 6));
        this.fixed(8, 8, bit(bits, 7));
        this.fixed(7, 8, bit(bits, 8));
        for (let i = 9; i < 15; i += 1) this.fixed(14 - i, 8, bit(bits, i));
        for (let i = 0; i < 8; i += 1) this.fixed(this.size - 1 - i, 8, bit(bits, i));
        for (let i = 8; i < 15; i += 1) this.fixed(8, this.size - 15 + i, bit(bits, i));
        this.fixed(8, this.size - 8, true);
    }

    drawData(data: readonly number[]): void {
        let i = 0;
        for (let right = this.size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < this.size; vert += 1)
                for (let j = 0; j < 2; j += 1) {
                    const x = right - j;
                    const y = ((right + 1) & 2) === 0 ? this.size - 1 - vert : vert;
                    const row = this.modules[y];
                    if (row === undefined || this.isReserved(x, y) || i >= data.length * 8)
                        continue;
                    row[x] = bit(data[i >>> 3] ?? 0, 7 - (i & 7));
                    i += 1;
                }
        }
    }

    applyMask(mask: number): void {
        const flips = MASKS[mask];
        if (flips === undefined) return;
        this.modules.forEach((row, y) => {
            row.forEach((dark, x) => {
                if (!this.isReserved(x, y) && flips(x, y)) row[x] = !dark;
            });
        });
    }

    penalty(): number {
        let score = 0;
        const n = this.size;
        const line = (at: (i: number) => boolean): void => {
            let colour = false;
            let run = 0;
            const history = [0, 0, 0, 0, 0, 0, 0];
            const push = (length: number): void => {
                history.pop();
                history.unshift(history[0] === 0 ? length + n : length);
            };
            const finders = (): number => {
                const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0] = history;
                const core = h1 > 0 && h2 === h1 && h3 === h1 * 3 && h4 === h1 && h5 === h1;
                return (
                    (core && h0 >= h1 * 4 && h6 >= h1 ? 1 : 0) +
                    (core && h6 >= h1 * 4 && h0 >= h1 ? 1 : 0)
                );
            };
            for (let i = 0; i < n; i += 1) {
                if (at(i) === colour) {
                    run += 1;
                    if (run === 5) score += 3;
                    else if (run > 5) score += 1;
                } else {
                    push(run);
                    if (!colour) score += finders() * 40;
                    colour = at(i);
                    run = 1;
                }
            }
            if (colour) {
                push(run);
                run = 0;
            }
            push(run + n);
            score += finders() * 40;
        };
        for (let y = 0; y < n; y += 1) line((x) => this.get(x, y));
        for (let x = 0; x < n; x += 1) line((y) => this.get(x, y));
        let dark = 0;
        for (let y = 0; y < n; y += 1)
            for (let x = 0; x < n; x += 1) {
                if (this.get(x, y)) dark += 1;
                if (x < n - 1 && y < n - 1) {
                    const c = this.get(x, y);
                    if (
                        c === this.get(x + 1, y) &&
                        c === this.get(x, y + 1) &&
                        c === this.get(x + 1, y + 1)
                    )
                        score += 3;
                }
            }
        const total = n * n;
        return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    }
}

export function payCodeMatrix(value: string): boolean[][] {
    const { version, data } = codewords(Array.from(new TextEncoder().encode(value)));
    const symbol = new Grid(version);
    symbol.drawPatterns();
    symbol.drawData(withErrorCorrection(version, data));
    let best = 0;
    let lowest = Infinity;
    for (let mask = 0; mask < MASKS.length; mask += 1) {
        symbol.applyMask(mask);
        symbol.drawFormat(mask);
        const score = symbol.penalty();
        if (score < lowest) {
            lowest = score;
            best = mask;
        }
        symbol.applyMask(mask);
    }
    symbol.applyMask(best);
    symbol.drawFormat(best);
    return symbol.modules;
}
