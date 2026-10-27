import os

from sqlalchemy.engine import make_url

# runs before conftest imports the settings, so each pytest-xdist worker opens its own database copy
_worker = os.environ.get("PYTEST_XDIST_WORKER")
if _worker is not None:
    for _name in ("DATABASE_URL", "MIGRATION_DATABASE_URL", "ADMIN_DATABASE_URL"):
        _url = make_url(os.environ[_name])
        os.environ[_name] = _url.set(database=f"{_url.database}_{_worker}").render_as_string(
            hide_password=False
        )
