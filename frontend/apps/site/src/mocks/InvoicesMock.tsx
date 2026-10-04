import { invoices, invoiceTable } from "../content/demo";

/** The Payments › Invoices list as a table, as on the web app. */
export function InvoicesMock() {
    const cols = invoiceTable.columns;
    return (
        <div className="mock card overflow-hidden" aria-hidden="true">
            <table className="tbl">
                <thead>
                    <tr>
                        <th>{cols.number}</th>
                        <th>{cols.client}</th>
                        <th>{cols.status}</th>
                        <th className="r">{cols.total}</th>
                    </tr>
                </thead>
                <tbody>
                    {invoices.map((row) => (
                        <tr key={row.number}>
                            <td className="mono">{row.number}</td>
                            <td>{row.client}</td>
                            <td>
                                <span className={`pill ${row.paid ? "pill-ok" : "pill-muted"}`}>
                                    {row.paid ? invoiceTable.paid : invoiceTable.draft}
                                </span>
                            </td>
                            <td className="r mono">{row.total}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
