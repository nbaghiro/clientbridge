from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from clientbridge.core.deps import EmailDep
from clientbridge.core.ratelimit import public_contact_rate_limit
from clientbridge.services.site import contact

router = APIRouter(tags=["site"])


@router.post("/contact", dependencies=[Depends(public_contact_rate_limit)])
async def submit_contact(request: Request, sender: EmailDep) -> RedirectResponse:
    if (
        request.headers.get("content-type", "").split(";", 1)[0]
        != "application/x-www-form-urlencoded"
    ):
        return RedirectResponse("/contact/retry", status_code=303)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 32768:
            return RedirectResponse("/contact/retry", status_code=303)
        body.extend(chunk)
    sent = await contact(bytes(body), sender)
    return RedirectResponse("/contact/thanks" if sent else "/contact/retry", status_code=303)
