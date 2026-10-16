from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import TypedDict

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from clientbridge.core.config import Settings, get_settings


class Base(DeclarativeBase):
    pass


class EngineOptions(TypedDict):
    pool_pre_ping: bool
    pool_size: int
    max_overflow: int


def engine_options(settings: Settings) -> EngineOptions:
    return {
        "pool_pre_ping": True,
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
    }


engine = create_async_engine(get_settings().database_url, **engine_options(get_settings()))
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def transaction(db: AsyncSession) -> AsyncIterator[None]:
    """Outermost call commits on exit; inner calls are savepoints. Any error rolls back."""
    if db.info.get("atomic"):
        async with db.begin_nested():
            yield
        return
    db.info["atomic"] = True
    try:
        yield
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    finally:
        db.info["atomic"] = False


def is_duplicate(exc: IntegrityError) -> bool:
    """True for a unique or primary-key conflict, the one integrity failure a replay may ignore."""
    return getattr(exc.orig, "pgcode", None) == "23505"
