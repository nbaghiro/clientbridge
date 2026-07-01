from fastapi import APIRouter

from clientbridge.sync.auth import router as auth_router
from clientbridge.sync.upload import router as upload_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(upload_router)
