import { stockList } from "../content/demo";

const TONE = { ok: "pill-ok", warn: "pill-warn", muted: "pill-muted" } as const;

/** Setup › Services & products with stock counts, as on the web app. */
export function StockListMock() {
    return (
        <div className="mock card stock-list" aria-hidden="true">
            <div className="stock-head">
                <span className="font-semibold">{stockList.title}</span>
                <div className="flex gap-1">
                    {stockList.filters.map((f, i) => (
                        <span
                            key={f}
                            className={`pill ${i === stockList.activeFilter ? "pill-accent" : "pill-muted"}`}
                        >
                            {f}
                        </span>
                    ))}
                </div>
            </div>
            {stockList.rows.map((row) => (
                <div key={row.sku} className="stock-row">
                    <img src={row.image} alt="" width={36} height={36} loading="lazy" />
                    <div className="min-w-0">
                        <div className="truncate font-medium">{row.name}</div>
                        <div className="xs muted mono">{row.sku}</div>
                    </div>
                    <span className={`pill ${TONE[row.tone]}`}>{row.stock}</span>
                    <span className="mono r">{row.price}</span>
                    {row.restock ? (
                        <span className="stock-restock">{stockList.restock}</span>
                    ) : (
                        <span />
                    )}
                </div>
            ))}
        </div>
    );
}
