from datetime import date

from fastapi import APIRouter, Response

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.reports import (
    DashboardSummary,
    GstHstReport,
    IncomeReport,
    SalesByItemRow,
    T4ARow,
)
from clientbridge.services.reports import DashboardService, ReportService

dashboard_router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@dashboard_router.get("/summary", response_model=DashboardSummary)
async def summary(principal: CurrentPrincipal, db: DbSession) -> DashboardSummary:
    return await DashboardService(db, principal).summary()


reports_router = APIRouter(prefix="/reports", tags=["reports"])


def _csv_response(content: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@reports_router.get("/income", response_model=IncomeReport)
async def income(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> IncomeReport:
    return await ReportService(db, principal).income_summary(start, end)


@reports_router.get("/income.csv")
async def income_csv(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> Response:
    content = await ReportService(db, principal).income_csv(start, end)
    return _csv_response(content, "income.csv")


@reports_router.get("/gst-hst", response_model=GstHstReport)
async def gst_hst(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> GstHstReport:
    return await ReportService(db, principal).gst_hst_return(start, end)


@reports_router.get("/gst-hst.csv")
async def gst_hst_csv(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> Response:
    content = await ReportService(db, principal).gst_hst_csv(start, end)
    return _csv_response(content, "gst-hst.csv")


@reports_router.get("/t4a", response_model=list[T4ARow])
async def t4a(principal: CurrentPrincipal, db: DbSession, year: int) -> list[T4ARow]:
    return await ReportService(db, principal).t4a_summary(year)


@reports_router.get("/t4a.csv")
async def t4a_csv(principal: CurrentPrincipal, db: DbSession, year: int) -> Response:
    content = await ReportService(db, principal).t4a_csv(year)
    return _csv_response(content, "t4a.csv")


@reports_router.get("/sales-by-item", response_model=list[SalesByItemRow])
async def sales_by_item(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> list[SalesByItemRow]:
    return await ReportService(db, principal).sales_by_item(start, end)


@reports_router.get("/sales-by-item.csv")
async def sales_by_item_csv(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> Response:
    content = await ReportService(db, principal).sales_by_item_csv(start, end)
    return _csv_response(content, "sales-by-item.csv")
