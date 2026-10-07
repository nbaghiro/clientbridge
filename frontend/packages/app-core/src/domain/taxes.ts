import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import type { ApiLike } from "../api";

export interface TaxRate {
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

export const TAX_REGISTERED_SQL = "SELECT tax_registered FROM businesses LIMIT 1";

interface TaxSetup {
    rates: TaxRate[] | null;
    registered: boolean;
}

/** The rates this business charges, and whether it collects tax at all (a small supplier doesn't). */
export function useTaxSetup(api: ApiLike): TaxSetup {
    const rates = useTaxRates(api);
    const row = useQuery<{ tax_registered: number | null }>(TAX_REGISTERED_SQL).data[0];
    return { rates, registered: row?.tax_registered !== 0 };
}
