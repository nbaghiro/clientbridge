import { useEffect, useState } from "react";

import type { ApiLike } from "../api";

export interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
    name: string;
}

/** Province tax rates (REST today; the abstraction is the single place to move to sync later). */
export function useTaxRates(api: ApiLike): TaxRate[] | null {
    const [rates, setRates] = useState<TaxRate[] | null>(null);
    useEffect(() => {
        api.get<TaxRate[]>("/v1/tax-rates")
            .then(setRates)
            .catch(() => {
                setRates([]);
            });
    }, [api]);
    return rates;
}
