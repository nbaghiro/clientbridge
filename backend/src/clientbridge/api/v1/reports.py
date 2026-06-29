from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from clientbridge.core.deps import DbSession, Principal, require_role
from clientbridge.schemas.reports import GstHstReport, IncomeReport, T4ARow
from clientbridge.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])

AdminPrincipal = Annotated[Principal, Depends(require_role("owner", "admin"))]


def _csv_response(content: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/income", response_model=IncomeReport)
async def income(principal: AdminPrincipal, db: DbSession, start: date, end: date) -> IncomeReport:
    return await ReportService(db, principal).income_summary(start, end)


@router.get("/income.csv")
async def income_csv(principal: AdminPrincipal, db: DbSession, start: date, end: date) -> Response:
    content = await ReportService(db, principal).income_csv(start, end)
    return _csv_response(content, "income.csv")


@router.get("/gst-hst", response_model=GstHstReport)
async def gst_hst(principal: AdminPrincipal, db: DbSession, start: date, end: date) -> GstHstReport:
    return await ReportService(db, principal).gst_hst_return(start, end)


@router.get("/gst-hst.csv")
async def gst_hst_csv(principal: AdminPrincipal, db: DbSession, start: date, end: date) -> Response:
    content = await ReportService(db, principal).gst_hst_csv(start, end)
    return _csv_response(content, "gst-hst.csv")


@router.get("/t4a", response_model=list[T4ARow])
async def t4a(principal: AdminPrincipal, db: DbSession, year: int) -> list[T4ARow]:
    return await ReportService(db, principal).t4a_summary(year)


@router.get("/t4a.csv")
async def t4a_csv(principal: AdminPrincipal, db: DbSession, year: int) -> Response:
    content = await ReportService(db, principal).t4a_csv(year)
    return _csv_response(content, "t4a.csv")
