"""Print the auth identity of an email, the ID a platform admin grant names."""

import argparse
import asyncio

from clientbridge.integrations.kratos import get_identity_provider


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("email")
    email = parser.parse_args().email
    identity_id = await get_identity_provider().find_identity(email)
    if identity_id is None:
        raise SystemExit(f"{email} has no account here; sign up and verify the email first")
    print(identity_id)


if __name__ == "__main__":
    asyncio.run(main())
