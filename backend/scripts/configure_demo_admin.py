"""Grant the existing demo owner platform access through development-only configuration."""

import asyncio
from pathlib import Path

from clientbridge.core.config import get_settings
from clientbridge.core.db import SessionLocal
from clientbridge.integrations.kratos import get_identity_provider
from clientbridge.models.business import User


def save_identity(path: Path, identity_id: str) -> None:
    key = "DEV_PLATFORM_ADMIN_IDENTITY_IDS"
    lines = path.read_text().splitlines() if path.exists() else []
    value = f"{key}={identity_id}"
    updated = [line for line in lines if not line.strip().startswith(f"{key}=")]
    updated.append(value)
    path.write_text("\n".join(updated) + "\n")


async def main() -> None:
    settings = get_settings()
    if settings.env != "dev":
        raise SystemExit("demo platform access can only be configured with ENV=dev")
    async with SessionLocal() as db:
        user = await db.get(User, "us_dev")
        if user is None or user.email != "hannah@birchbark.example":
            raise SystemExit("seed the demo accounts with make seed first")
        identity_id = await get_identity_provider().find_identity(user.email)
        if identity_id is None or identity_id != user.identity_id:
            raise SystemExit("the demo account is not linked to its current auth identity")
        save_identity(Path(".env"), identity_id)
    print("Configured Hannah Wong (hannah@birchbark.example) as a development platform admin.")
    print("Restart the API to load the grant. Other demo accounts remain non-admin.")


if __name__ == "__main__":
    asyncio.run(main())
