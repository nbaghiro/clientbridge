from datetime import date

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    today_revenue_cents: int  # net succeeded payments received today (in the business's timezone)
    awaiting_payment_cents: int  # outstanding balance across sent/partial/overdue invoices
    gst_hst_set_aside_cents: int  # Σ tax on paid invoices — the CRA remittance to set aside
    gst_hst_filing_due: date | None  # next CRA filing date (None unless tax-registered)
