from fastapi import APIRouter

from clientbridge.sync.jwks import router as jwks_router
from clientbridge.sync.token import router as token_router
from clientbridge.sync.upload import router as upload_router

router = APIRouter()
router.include_router(token_router)
router.include_router(upload_router)
router.include_router(jwks_router)
