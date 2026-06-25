import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

from clientbridge.core.config import get_settings
from clientbridge.core.db import Base
from clientbridge import models  # noqa: F401  — import all models so metadata is populated

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# psycopg/asyncpg URL from settings (not from alembic.ini)
config.set_main_option("sqlalchemy.url", get_settings().database_url)

target_metadata = Base.metadata


def _run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async() -> None:
    cfg = config.get_section(config.config_ini_section, {})
    engine = async_engine_from_config(cfg, prefix="sqlalchemy.", poolclass=NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_run_migrations)
    await engine.dispose()


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async())
