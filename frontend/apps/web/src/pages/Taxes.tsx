import { strings, useTaxRates } from "@clientbridge/app-core";
import { Badge, Empty, Loading, Panel } from "@clientbridge/ui";

import { api } from "../lib/api";

export function Taxes() {
    const rates = useTaxRates(api);

    return (
        <div>
            <h2 className="font-display text-lg font-semibold text-ink">{strings.taxes.title}</h2>
            <p className="mt-1 text-sm text-muted">{strings.taxes.subtitle}</p>

            <div className="mt-6">
                <Panel flush>
                    {rates === null ? (
                        <Loading />
                    ) : rates.length === 0 ? (
                        <Empty message={strings.taxes.empty} />
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                                    <th className="px-4 py-3 font-semibold">
                                        {strings.taxes.colTax}
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                        {strings.taxes.colProvince}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rates.map((r) => (
                                    <tr
                                        key={r.id}
                                        className="border-b border-line-soft last:border-0"
                                    >
                                        <td className="flex items-center gap-2 px-4 py-3">
                                            <Badge label={r.jurisdiction} />
                                            <span className="font-medium text-ink">{r.name}</span>
                                        </td>
                                        <td className="px-4 py-3 text-ink-soft">{r.province}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Panel>
            </div>

            <p className="mt-3 text-xs text-muted">{strings.taxes.footnote}</p>
        </div>
    );
}
