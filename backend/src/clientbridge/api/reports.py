from datetime import date

from fastapi import APIRouter, Response

from clientbridge.core.deps import CurrentPrincipal, DbSession
from clientbridge.schemas.reports import (
    DashboardSummary,
    GstHstReport,
    ReportExportIn,
    ReportSummary,
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


@reports_router.get("/t4a.csv")
async def t4a_csv(principal: CurrentPrincipal, db: DbSession, year: int) -> Response:
    content = await ReportService(db, principal).t4a_csv(year)
    return _csv_response(content, "t4a.csv")


@reports_router.get("/sales-by-item.csv")
async def sales_by_item_csv(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> Response:
    content = await ReportService(db, principal).sales_by_item_csv(start, end)
    return _csv_response(content, "sales-by-item.csv")


@reports_router.get("/summary", response_model=ReportSummary)
async def report_summary(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> ReportSummary:
    return await ReportService(db, principal).summary(start, end)


@reports_router.get("/pst.csv")
async def pst_csv(principal: CurrentPrincipal, db: DbSession, start: date, end: date) -> Response:
    content = await ReportService(db, principal).pst_csv(start, end)
    return _csv_response(content, "pst.csv")


@reports_router.get("/payouts.csv")
async def payouts_csv(
    principal: CurrentPrincipal, db: DbSession, start: date, end: date
) -> Response:
    content = await ReportService(db, principal).payouts_csv(start, end)
    return _csv_response(content, "payouts.csv")


@reports_router.post(
    "/export",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "A ZIP of CSVs"}},
)
async def export_reports(
    data: ReportExportIn, principal: CurrentPrincipal, db: DbSession
) -> Response:
    content = await ReportService(db, principal).export_zip(data.kinds, data.start, data.end)
    name = f"bookkeeper-{data.start}-to-{data.end}.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={name}"},
    )
