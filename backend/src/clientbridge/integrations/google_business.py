import base64
import hashlib
import re
from datetime import datetime
from typing import Literal, Protocol
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from clientbridge.core.errors import AppError
from clientbridge.integrations.http import http_session

BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage"
_ACCOUNT = re.compile(r"accounts/[A-Za-z0-9_-]+")
_LOCATION = re.compile(r"locations/[A-Za-z0-9_-]+")
_REVIEW = re.compile(r"accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+/reviews/[A-Za-z0-9_-]+")


class GoogleBusinessError(AppError):
    status_code = 502
    code = "google_unavailable"


class GoogleData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class GoogleTokens(GoogleData):
    access_token: str = Field(repr=False)
    expires_in: int = Field(ge=1)
    refresh_token: str | None = Field(default=None, repr=False)
    scope: str = ""
    token_type: str = "Bearer"


class GoogleAccount(GoogleData):
    name: str
    title: str = Field(alias="accountName")


class GoogleAccounts(GoogleData):
    accounts: list[GoogleAccount] = Field(default_factory=list)
    next_page_token: str | None = Field(default=None, alias="nextPageToken")


class GoogleMetadata(GoogleData):
    new_review_uri: str | None = Field(default=None, alias="newReviewUri")
    maps_uri: str | None = Field(default=None, alias="mapsUri")


class GoogleLocation(GoogleData):
    name: str
    title: str
    metadata: GoogleMetadata = Field(default_factory=GoogleMetadata)


class GoogleLocations(GoogleData):
    locations: list[GoogleLocation] = Field(default_factory=list)
    next_page_token: str | None = Field(default=None, alias="nextPageToken")


class GoogleReviewer(GoogleData):
    display_name: str | None = Field(default=None, alias="displayName")
    anonymous: bool = Field(default=False, alias="isAnonymous")


class GoogleReply(GoogleData):
    comment: str
    update_time: datetime | None = Field(default=None, alias="updateTime")


class GoogleReview(GoogleData):
    review_id: str = Field(alias="reviewId")
    reviewer: GoogleReviewer = Field(default_factory=GoogleReviewer)
    star_rating: Literal["ONE", "TWO", "THREE", "FOUR", "FIVE"] = Field(alias="starRating")
    comment: str | None = None
    create_time: datetime = Field(alias="createTime")
    update_time: datetime = Field(alias="updateTime")
    reply: GoogleReply | None = Field(default=None, alias="reviewReply")


class GoogleReviews(GoogleData):
    reviews: list[GoogleReview] = Field(default_factory=list)
    average_rating: float | None = Field(default=None, alias="averageRating", ge=0, le=5)
    total_count: int = Field(default=0, alias="totalReviewCount", ge=0)
    next_page_token: str | None = Field(default=None, alias="nextPageToken")


class GoogleBusinessGateway(Protocol):
    def authorization_url(self, state: str, verifier: str) -> str: ...
    async def exchange(self, code: str, verifier: str) -> GoogleTokens: ...
    async def refresh(self, refresh_token: str) -> GoogleTokens: ...
    async def revoke(self, refresh_token: str) -> None: ...
    async def accounts(self, token: str, page: str | None = None) -> GoogleAccounts: ...
    async def locations(
        self, token: str, account: str, page: str | None = None
    ) -> GoogleLocations: ...
    async def location(self, token: str, location: str) -> GoogleLocation: ...
    async def reviews(self, token: str, parent: str, page: str | None = None) -> GoogleReviews: ...
    async def review(self, token: str, name: str) -> GoogleReview: ...
    async def put_reply(self, token: str, name: str, comment: str) -> GoogleReply: ...
    async def delete_reply(self, token: str, name: str) -> None: ...


def review_parent(account: str, location: str) -> str:
    if not _ACCOUNT.fullmatch(account) or not _LOCATION.fullmatch(location):
        raise GoogleBusinessError("invalid Google resource name", code="google_invalid_resource")
    return f"{account}/{location}"


def review_name(parent: str, review_id: str) -> str:
    name = f"{parent}/reviews/{review_id}"
    if not _REVIEW.fullmatch(name):
        raise GoogleBusinessError("invalid Google review name", code="google_invalid_resource")
    return name


class HttpGoogleBusinessGateway:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def authorization_url(self, state: str, verifier: str) -> str:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": BUSINESS_SCOPE,
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
                "code_challenge_method": "S256",
                "code_challenge": challenge.decode().rstrip("="),
            }
        )

    async def _request(
        self,
        method: str,
        url: str,
        *,
        token: str | None = None,
        params: dict[str, str | int] | None = None,
        data: dict[str, str] | None = None,
        body: dict[str, str] | None = None,
    ) -> object:
        try:
            async with http_session() as client:
                response = await client.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    json=body,
                    headers={"Authorization": f"Bearer {token}"} if token else {},
                    timeout=httpx.Timeout(20.0, connect=5.0),
                )
        except httpx.HTTPError:
            raise GoogleBusinessError("Google request failed") from None
        if len(response.content) > 4 * 1024 * 1024:
            raise GoogleBusinessError("Google response exceeded the size limit")
        if response.status_code == 401:
            raise GoogleBusinessError(
                "Google authorization expired", code="google_reconnect_required", status_code=409
            )
        if response.status_code == 403:
            raise GoogleBusinessError(
                "Google access denied", code="google_access_denied", status_code=403
            )
        if response.status_code == 404:
            raise GoogleBusinessError(
                "Google resource not found", code="google_not_found", status_code=404
            )
        if response.status_code == 429:
            raise GoogleBusinessError(
                "Google rate limit reached", code="google_rate_limited", status_code=429
            )
        if response.status_code >= 500:
            raise GoogleBusinessError("Google service unavailable")
        if not response.content:
            if response.is_success:
                return {}
            raise GoogleBusinessError("Google request rejected")
        try:
            payload: object = response.json()
        except ValueError:
            raise GoogleBusinessError("Google returned invalid data") from None
        if not response.is_success:
            if isinstance(payload, dict) and payload.get("error") == "invalid_grant":
                raise GoogleBusinessError(
                    "Google grant expired", code="google_reconnect_required", status_code=409
                )
            raise GoogleBusinessError(
                "Google request rejected", code="google_request_rejected", status_code=422
            )
        return payload

    async def _token(self, data: dict[str, str]) -> GoogleTokens:
        payload = await self._request(
            "POST",
            "https://oauth2.googleapis.com/token",
            data={
                **data,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
        )
        return _parse(GoogleTokens, payload)

    async def exchange(self, code: str, verifier: str) -> GoogleTokens:
        return await self._token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": self.redirect_uri,
            }
        )

    async def refresh(self, refresh_token: str) -> GoogleTokens:
        return await self._token({"grant_type": "refresh_token", "refresh_token": refresh_token})

    async def revoke(self, refresh_token: str) -> None:
        await self._request(
            "POST", "https://oauth2.googleapis.com/revoke", data={"token": refresh_token}
        )

    async def accounts(self, token: str, page: str | None = None) -> GoogleAccounts:
        params: dict[str, str | int] = {"pageSize": 20}
        if page:
            params["pageToken"] = page
        return _parse(
            GoogleAccounts,
            await self._request(
                "GET",
                "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
                token=token,
                params=params,
            ),
        )

    async def locations(self, token: str, account: str, page: str | None = None) -> GoogleLocations:
        review_parent(account, "locations/validate")
        params: dict[str, str | int] = {"pageSize": 100, "readMask": "name,title,metadata"}
        if page:
            params["pageToken"] = page
        return _parse(
            GoogleLocations,
            await self._request(
                "GET",
                f"https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations",
                token=token,
                params=params,
            ),
        )

    async def location(self, token: str, location: str) -> GoogleLocation:
        review_parent("accounts/validate", location)
        return _parse(
            GoogleLocation,
            await self._request(
                "GET",
                f"https://mybusinessbusinessinformation.googleapis.com/v1/{location}",
                token=token,
                params={"readMask": "name,title,metadata"},
            ),
        )

    async def reviews(self, token: str, parent: str, page: str | None = None) -> GoogleReviews:
        review_name(parent, "validate")
        params: dict[str, str | int] = {"pageSize": 50, "orderBy": "updateTime desc"}
        if page:
            params["pageToken"] = page
        return _parse(
            GoogleReviews,
            await self._request(
                "GET",
                f"https://mybusiness.googleapis.com/v4/{parent}/reviews",
                token=token,
                params=params,
            ),
        )

    async def review(self, token: str, name: str) -> GoogleReview:
        self._validate_review(name)
        return _parse(
            GoogleReview,
            await self._request("GET", f"https://mybusiness.googleapis.com/v4/{name}", token=token),
        )

    async def put_reply(self, token: str, name: str, comment: str) -> GoogleReply:
        self._validate_review(name)
        return _parse(
            GoogleReply,
            await self._request(
                "PUT",
                f"https://mybusiness.googleapis.com/v4/{name}/reply",
                token=token,
                body={"comment": comment},
            ),
        )

    async def delete_reply(self, token: str, name: str) -> None:
        self._validate_review(name)
        await self._request(
            "DELETE", f"https://mybusiness.googleapis.com/v4/{name}/reply", token=token
        )

    @staticmethod
    def _validate_review(name: str) -> None:
        if not _REVIEW.fullmatch(name):
            raise GoogleBusinessError("invalid Google review name", code="google_invalid_resource")


def _parse[T: BaseModel](model: type[T], payload: object) -> T:
    try:
        return model.model_validate(payload)
    except ValidationError:
        raise GoogleBusinessError("Google returned an invalid response") from None
