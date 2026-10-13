// Generated from services/tax.py by `make gen-taxes`; edit the backend rate table.
import type { RateRow } from "./domain/taxes";

export const FEDERAL_TAX_CODES: readonly string[] = ["GST", "HST"];

export const TAX_RATES: readonly RateRow[] = [
    { province: "AB", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "BC", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "BC", code: "PST", ppm: 70000, from: "2013-04-01" },
    { province: "MB", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "MB", code: "RST", ppm: 70000, from: "2019-07-01" },
    { province: "NB", code: "HST", ppm: 150000, from: "2016-07-01" },
    { province: "NL", code: "HST", ppm: 150000, from: "2016-07-01" },
    { province: "NS", code: "HST", ppm: 150000, from: "2010-07-01" },
    { province: "NS", code: "HST", ppm: 140000, from: "2025-04-01" },
    { province: "NT", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "NU", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "ON", code: "HST", ppm: 130000, from: "2010-07-01" },
    { province: "PE", code: "HST", ppm: 150000, from: "2016-10-01" },
    { province: "QC", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "QC", code: "QST", ppm: 99750, from: "2013-01-01" },
    { province: "SK", code: "GST", ppm: 50000, from: "2008-01-01" },
    { province: "SK", code: "PST", ppm: 60000, from: "2017-03-23" },
    { province: "YT", code: "GST", ppm: 50000, from: "2008-01-01" },
];
