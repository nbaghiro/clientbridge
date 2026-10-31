from fastapi import APIRouter

from clientbridge.core.deps import CurrentIdentity, DbSession, FreshIdentity, FreshUser, IdentityDep
from clientbridge.schemas.auth import DevVerificationIn, MeOut
from clientbridge.services.auth import AuthService

router = APIRouter(prefix="/me", tags=["auth"])


@router.get("", response_model=MeOut)
async def me(user: FreshUser, identity: FreshIdentity) -> MeOut:
    return MeOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        email_verified=identity.email_verified,
        second_factor=identity.second_factor,
    )


@router.post("/verification", status_code=204)
async def verify_with_dev_code(
    body: DevVerificationIn, identity: CurrentIdentity, identities: IdentityDep, db: DbSession
) -> None:
    await AuthService(db).verify_with_dev_code(identity, body.code, identities)
