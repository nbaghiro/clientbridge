import { useEffect, useState } from "react";

import { api } from "../lib/api";

interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
    name: string;
}

export function TaxSettings() {
    const [rates, setRates] = useState<TaxRate[] | null>(null);

    useEffect(() => {
        void api
            .get<TaxRate[]>("/v1/tax-rates")
            .then(setRates)
            .catch(() => {
                setRates([]);
            });
    }, []);

    return (
        <div>
            <h1 className="font-display text-2xl font-bold text-ink">Taxes</h1>
            <p className="mt-1 text-sm text-muted">
                Sales tax applied to your invoices, based on your province.
            </p>

            <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
                {rates === null ? (
                    <p className="px-4 py-10 text-center text-sm text-muted">Loading…</p>
                ) : rates.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted">
                        No tax rates set for your province yet.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                                <th className="px-4 py-3 font-semibold">Tax</th>
                                <th className="px-4 py-3 font-semibold">Province</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rates.map((r) => (
                                <tr key={r.id} className="border-b border-line-soft last:border-0">
                                    <td className="px-4 py-3">
                                        <span className="mr-2 rounded-full bg-accent-weak px-2 py-0.5 text-xs font-semibold text-accent">
                                            {r.jurisdiction}
                                        </span>
                                        <span className="font-medium text-ink">{r.name}</span>
                                    </td>
                                    <td className="px-4 py-3 text-ink-soft">{r.province}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <p className="mt-3 text-xs text-muted">
                Rates are seeded per province; small-supplier and registration settings come with
                the payments slice.
            </p>
        </div>
    );
}
