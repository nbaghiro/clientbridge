from datetime import date, datetime
from typing import Literal

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
        description="Next GST/HST return due date; null unless tax-registered"
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


class T4APayee(BaseModel):
    staff_id: str
    name: str
    payments: int = Field(description="Payments made to the staff member in the calendar year")
    total_cents: int


class IncomeSummary(BaseModel):
    sales_cents: int = Field(description="Revenue booked in the period before tax and refunds")
    refunds_cents: int = Field(description="Revenue returned by refunds, before tax")
    net_cents: int = Field(description="Sales minus refunds, before tax")
    tax_by_code: dict[str, int] = Field(description="Tax booked per code (GST, HST, PST, QST)")
    tips_cents: int = Field(description="Tips owed to staff, kept apart from sales")
    received_cents: int = Field(description="Money received net of refunds, with tax and tips")
    by_method: dict[str, int] = Field(description="Money received per payment method")


class ProvincialReport(BaseModel):
    code: str | None = Field(description="PST or QST; null when the province has none")
    rate_bps: int | None
    taxable_cents: int = Field(description="Sales that carried the provincial tax")
    collected_cents: int
    number: str | None


class MonthNet(BaseModel):
    month: str = Field(description="YYYY-MM in the business timezone")
    net_cents: int = Field(description="Revenue before tax, after refunds")


class PayoutRow(BaseModel):
    id: str
    amount_cents: int
    arrival_at: datetime | None
    status: str = Field(description="paid, or failed when the bank returned it")


class ReportRate(BaseModel):
    code: str
    name: str
    rate_bps: int


class ReportSummary(BaseModel):
    start: date
    end: date
    income: IncomeSummary
    sales_by_item: list[SalesByItemRow]
    gst_hst: GstHstReport
    provincial: ProvincialReport
    t4a_year: int
    t4a: list[T4APayee]
    months: list[MonthNet] = Field(description="Every month of the end date's year so far")
    payouts: list[PayoutRow] = Field(description="Bank deposits that arrived in the period")
    rates: list[ReportRate]


ExportKind = Literal["income", "sales-by-item", "gst-hst", "pst", "t4a", "payouts"]


class ReportExportIn(BaseModel):
    kinds: list[ExportKind] = Field(min_length=1)
    start: date
    end: date
