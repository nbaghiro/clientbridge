from typing import Annotated

from fastapi import Depends, Query
from pydantic import BaseModel


class PageParams(BaseModel):
    limit: int
    offset: int


def page_params(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


PageQuery = Annotated[PageParams, Depends(page_params)]


class Page[T](BaseModel):
    """A page of results plus the total count for the same (business-scoped) filter."""

    items: list[T]
    total: int
    limit: int
    offset: int
