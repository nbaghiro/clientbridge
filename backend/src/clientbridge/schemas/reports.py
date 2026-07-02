from pydantic import BaseModel


class IncomeReport(BaseModel):
    gross_cents: int  # succeeded payment + deposit receipts in the period
    refunds_cents: int  # succeeded refunds in the period
    net_cents: int  # gross minus refunds (the T2125 income line)
    by_method: dict[str, int]  # net per payment method (card/interac/eft/…)


class GstHstReport(BaseModel):
    tax_collected_cents: int  # Σ GST/HST on paid invoices/orders — the federal amount to remit
    pst_cents: int  # Σ PST (BC/SK/MB) — filed separately with the province
    qst_cents: int  # Σ QST — filed separately with Revenu Québec
    taxable_sales_cents: int  # pre-tax sales (total minus tax) on those invoices
    gst_hst_number: str | None


class T4ARow(BaseModel):
    staff_id: str
    name: str
    total_cents: int  # Σ approved/paid payout allocations in the calendar year
