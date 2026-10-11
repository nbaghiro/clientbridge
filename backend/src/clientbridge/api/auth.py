from fastapi import APIRouter

from clientbridge.core.deps import CurrentIdentity, CurrentUser
from clientbridge.schemas.auth import MeOut

router = APIRouter(prefix="/me", tags=["auth"])


@router.get("", response_model=MeOut)
async def me(user: CurrentUser, identity: CurrentIdentity) -> MeOut:
    return MeOut(
        user_id=user.id,
        email=user.email,
        name=user.name,
        email_verified=identity.email_verified,
        aal=identity.aal,
    )
