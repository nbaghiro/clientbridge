from datetime import date

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    today_revenue_cents: int  # net succeeded payments received today (in the business's timezone)
    awaiting_payment_cents: int  # outstanding balance across sent/partial/overdue invoices
    gst_hst_set_aside_cents: int  # Σ tax on paid invoices — the CRA remittance to set aside
    gst_hst_filing_due: date | None  # next CRA filing date (None unless tax-registered)


class IncomeReport(BaseModel):
    gross_cents: int  # succeeded payment + deposit receipts in the period
    refunds_cents: int  # succeeded refunds in the period
    net_cents: int  # gross minus refunds (the T2125 income line)
    by_method: dict[str, int]  # net per payment method (card/interac/bank_eft/…)


class GstHstReport(BaseModel):
    tax_collected_cents: int  # Σ GST/HST on paid invoices/orders — the federal amount to remit
    pst_cents: int  # Σ PST (BC/SK/MB) — filed separately with the province
    qst_cents: int  # Σ QST — filed separately with Revenu Québec
    taxable_sales_cents: int  # pre-tax sales (total minus tax) on those invoices
    gst_hst_number: str | None


class T4ARow(BaseModel):
    staff_id: str
    name: str
    total_cents: int  # approved or paid earnings in the calendar year


class SalesByItemRow(BaseModel):
    item_id: str
    name: str
    kind: str
    quantity: float
    sales_cents: int  # before tax, including sales later refunded in full
    tax_cents: int
    refunded_cents: int  # sales in the period that were refunded in full
