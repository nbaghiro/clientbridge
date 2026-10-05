from datetime import date

from pydantic import BaseModel, Field


class DashboardSummary(BaseModel):
    today_revenue_cents: int = Field(
        description="Cash received today net of refunds, in the business's timezone"
    )
    awaiting_payment_cents: int = Field(description="Balance owed on issued invoices")
    gst_hst_set_aside_cents: int = Field(
        description="Sales tax collected and not yet filed (GST/HST, PST and QST)"
    )
    gst_hst_filing_due: date | None = Field(
        description="Next quarterly GST/HST filing date; null unless tax-registered"
    )


class IncomeReport(BaseModel):
    gross_cents: int = Field(description="Payments and deposits received in the period")
    refunds_cents: int = Field(description="Refunds paid out in the period")
    net_cents: int = Field(description="Gross minus refunds")
    by_method: dict[str, int] = Field(description="Net received per payment method")


class GstHstReport(BaseModel):
    tax_collected_cents: int = Field(description="GST and HST booked in the period")
    pst_cents: int = Field(description="PST booked in the period, filed with the province")
    qst_cents: int = Field(description="QST booked in the period, filed with Revenu Québec")
    taxable_sales_cents: int = Field(description="Sales before tax booked in the period")
    gst_hst_number: str | None


class T4ARow(BaseModel):
    staff_id: str
    name: str
    total_cents: int = Field(description="Earnings paid to the staff member in the calendar year")


class SalesByItemRow(BaseModel):
    item_id: str
    name: str
    kind: str
    quantity: float
    sales_cents: int = Field(description="Sales before tax, including sales later refunded")
    tax_cents: int
    refunded_cents: int = Field(description="Sales in the period that were refunded in full")
