import { useEffect, useState } from "react";

import type { ApiLike } from "../api";

interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
    name: string;
}

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
