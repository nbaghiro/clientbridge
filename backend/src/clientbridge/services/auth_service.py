"""Password auth + refresh-token sessions.

Refresh tokens are opaque high-entropy strings, stored only as a SHA-256 hash in `auth_sessions`,
grouped into a family per login. Each refresh rotates the token; replaying an already-rotated token
revokes the whole family (reuse-detection). Access tokens are short-lived JWTs.
"""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Conflict, Unauthorized
from clientbridge.core.ids import new_id
from clientbridge.core.security import (
    hash_password,
    hash_token,
    issue_access_token,
    verify_password,
)
from clientbridge.integrations.email import Email, EmailSender
from clientbridge.integrations.oauth import OAuthProfile
from clientbridge.models.auth import AuthSession, AuthToken
from clientbridge.models.identity import User
from clientbridge.schemas.auth import TokenPair

RESET_TTL = timedelta(hours=1)
VERIFY_TTL = timedelta(hours=24)


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def register(self, email: str, password: str, name: str | None) -> User:
        existing = (
            await self.db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("email already registered")
        user = User(
            id=new_id("user"),
            email=email,
            password_hash=hash_password(password),
            name=name,
            oauth={},
        )
        self.db.add(user)
        await self.db.flush()
        return user

    async def oauth_login(self, profile: OAuthProfile) -> User:
        """Find-or-create a user by the OAuth email, linking the provider identity."""
        user = (
            await self.db.execute(select(User).where(User.email == profile.email))
        ).scalar_one_or_none()
        if user is None:
            user = User(
                id=new_id("user"),
                email=profile.email,
                name=profile.name,
                password_hash=None,
                oauth={"google": profile.sub},
                email_verified_at=datetime.now(UTC) if profile.email_verified else None,
            )
            self.db.add(user)
            await self.db.flush()
        else:
            if "google" not in user.oauth:
                user.oauth = {**user.oauth, "google": profile.sub}
            if profile.email_verified and user.email_verified_at is None:
                user.email_verified_at = datetime.now(UTC)
        await self.db.commit()
        return user

    async def authenticate(self, email: str, password: str) -> User:
        user = (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if (
            user is None
            or user.password_hash is None
            or not verify_password(password, user.password_hash)
        ):
            raise Unauthorized("invalid email or password")
        return user

    async def issue_session(
        self, user_id: str, *, family_id: str | None = None, device: str | None = None
    ) -> TokenPair:
        refresh = secrets.token_urlsafe(32)
        ttl = timedelta(days=get_settings().refresh_token_ttl_days)
        self.db.add(
            AuthSession(
                id=new_id("auth_session"),
                user_id=user_id,
                family_id=family_id or new_id("auth_session"),
                token_hash=hash_token(refresh),
                device=device,
                expires_at=datetime.now(UTC) + ttl,
            )
        )
        await self.db.commit()
        return TokenPair(access_token=issue_access_token(user_id), refresh_token=refresh)

    async def rotate(self, refresh_token: str) -> TokenPair:
        session = (
            await self.db.execute(
                select(AuthSession).where(AuthSession.token_hash == hash_token(refresh_token))
            )
        ).scalar_one_or_none()
        if session is None:
            raise Unauthorized("invalid refresh token")
        if session.revoked_at is not None:
            # replay of an already-rotated token → kill the whole family
            await self._revoke_family(session.family_id)
            await self.db.commit()
            raise Unauthorized("refresh token reuse detected")
        if session.expires_at < datetime.now(UTC):
            raise Unauthorized("refresh token expired")
        session.revoked_at = datetime.now(UTC)
        await self.db.flush()
        return await self.issue_session(
            session.user_id, family_id=session.family_id, device=session.device
        )

    async def revoke(self, refresh_token: str) -> None:
        session = (
            await self.db.execute(
                select(AuthSession).where(AuthSession.token_hash == hash_token(refresh_token))
            )
        ).scalar_one_or_none()
        if session is not None:
            await self._revoke_family(session.family_id)
            await self.db.commit()

    async def _revoke_family(self, family_id: str) -> None:
        await self.db.execute(
            update(AuthSession)
            .where(AuthSession.family_id == family_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

    # ── one-time tokens (password reset / email verification) ─────────────────────────────────
    async def _create_token(self, user_id: str, purpose: str, ttl: timedelta) -> str:
        raw = secrets.token_urlsafe(24)
        self.db.add(
            AuthToken(
                id=new_id("auth_token"),
                user_id=user_id,
                purpose=purpose,
                token_hash=hash_token(raw),
                expires_at=datetime.now(UTC) + ttl,
            )
        )
        await self.db.flush()
        return raw

    async def _consume_token(self, token: str, purpose: str) -> AuthToken:
        tok = (
            await self.db.execute(
                select(AuthToken).where(
                    AuthToken.token_hash == hash_token(token), AuthToken.purpose == purpose
                )
            )
        ).scalar_one_or_none()
        if tok is None or tok.used_at is not None:
            raise Unauthorized("invalid or used token")
        if tok.expires_at < datetime.now(UTC):
            raise Unauthorized("token expired")
        tok.used_at = datetime.now(UTC)
        await self.db.flush()
        return tok

    async def request_password_reset(self, email: str, email_sender: EmailSender) -> None:
        """Always silent (no account enumeration); only sends if the user exists."""
        user = (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            return
        raw = await self._create_token(user.id, "reset", RESET_TTL)
        await self.db.commit()
        await email_sender.send(
            Email(to=email, subject="Reset your password", body=f"Reset code: {raw}")
        )

    async def reset_password(self, token: str, new_password: str) -> None:
        tok = await self._consume_token(token, "reset")
        user = await self.db.get(User, tok.user_id)
        if user is None:
            raise Unauthorized("invalid token")
        user.password_hash = hash_password(new_password)
        # a password reset invalidates every existing session
        await self.db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        await self.db.commit()

    async def send_verification(self, user_id: str, email: str, email_sender: EmailSender) -> None:
        raw = await self._create_token(user_id, "verify", VERIFY_TTL)
        await self.db.commit()
        await email_sender.send(
            Email(to=email, subject="Verify your email", body=f"Verify code: {raw}")
        )

    async def verify_email(self, token: str) -> None:
        tok = await self._consume_token(token, "verify")
        user = await self.db.get(User, tok.user_id)
        if user is None:
            raise Unauthorized("invalid token")
        user.email_verified_at = datetime.now(UTC)
        await self.db.commit()
