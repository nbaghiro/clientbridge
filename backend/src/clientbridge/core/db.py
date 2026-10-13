from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from clientbridge.core.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
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
