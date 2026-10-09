"""Password auth and rotating refresh-token sessions with reuse detection."""

import secrets
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import Conflict, TooManyRequests, Unauthorized
from clientbridge.core.ids import new_id
from clientbridge.core.ratelimit import login_guard
from clientbridge.core.security import (
    hash_password,
    hash_token,
    issue_access_token,
    refresh_cipher,
    verify_password,
)
from clientbridge.integrations.google import OAuthProfile
from clientbridge.integrations.postmark import Email, EmailSender
from clientbridge.models.auth import AuthSession, AuthToken
from clientbridge.models.business import User
from clientbridge.schemas.auth import TokenPair

RESET_TTL = timedelta(hours=1)
VERIFY_TTL = timedelta(hours=24)

# Verified against when an account is missing, so login timing doesn't reveal registered emails.
_DUMMY_HASH = hash_password("clientbridge-timing-guard")


def build_user(*, email: str, password: str, name: str | None) -> User:
    """A new password account; the one place credentials are minted."""
    return User(
        id=new_id("user"),
        email=email,
        password_hash=hash_password(password),
        name=name,
        oauth={},
    )


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def register(self, email: str, password: str, name: str | None) -> User:
        existing = (
            await self.db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            raise Conflict("email already registered")
        user = build_user(email=email, password=password, name=name)
        self.db.add(user)
        await self.db.flush()
        return user

    async def oauth_login(self, profile: OAuthProfile) -> User:
        """Find-or-create a user by the OAuth email, linking the provider identity."""
        if not profile.email_verified:
            # An unverified provider email could claim someone else's account.
            raise Unauthorized("your email address is not verified with the provider")
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
        now = time.monotonic()
        if login_guard.locked(email, now):
            raise TooManyRequests(
                "too many sign-in attempts, try again in 15 minutes", code="login_locked"
            )
        user = (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        stored = user.password_hash if user is not None and user.password_hash is not None else None
        matched = verify_password(password, stored if stored is not None else _DUMMY_HASH)
        if user is None or stored is None or not matched:
            login_guard.failed(email, now)
            raise Unauthorized("invalid email or password")
        login_guard.succeeded(email)
        return user

    def _new_session(
        self, user_id: str, *, family_id: str | None = None, device: str | None = None
    ) -> tuple[AuthSession, TokenPair]:
        refresh = secrets.token_urlsafe(32)
        session = AuthSession(
            id=new_id("auth_session"),
            user_id=user_id,
            family_id=family_id or new_id("auth_session"),
            token_hash=hash_token(refresh),
            device=device,
            expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_ttl_days),
        )
        self.db.add(session)
        return session, TokenPair(
            access_token=issue_access_token(user_id, family_id=session.family_id),
            refresh_token=refresh,
        )

    async def issue_session(
        self, user_id: str, *, family_id: str | None = None, device: str | None = None
    ) -> TokenPair:
        await self.db.scalar(select(User.id).where(User.id == user_id).with_for_update())
        _, pair = self._new_session(user_id, family_id=family_id, device=device)
        await self.db.commit()
        return pair

    async def _locked_session(self, refresh_token: str) -> AuthSession | None:
        session = await self.db.scalar(
            select(AuthSession).where(AuthSession.token_hash == hash_token(refresh_token))
        )
        if session is not None:
            await self.db.scalar(
                select(User.id).where(User.id == session.user_id).with_for_update()
            )
            await self.db.refresh(session, with_for_update=True)
        return session

    async def rotate(self, refresh_token: str, *, attempt_id: str) -> TokenPair:
        session = await self._locked_session(refresh_token)
        if session is None:
            raise Unauthorized("invalid refresh token")
        now = datetime.now(UTC)
        if session.revoked_at is not None:
            if (
                session.replay_attempt_id == attempt_id
                and session.replay_expires_at is not None
                and session.replay_expires_at > now
                and session.replay_ciphertext is not None
                and session.replay_session_id is not None
            ):
                replacement = await self.db.get(AuthSession, session.replay_session_id)
                if (
                    replacement is not None
                    and replacement.revoked_at is None
                    and replacement.expires_at > now
                ):
                    pair = TokenPair.model_validate_json(
                        refresh_cipher().decrypt(session.replay_ciphertext.encode())
                    )
                    await self.db.commit()
                    return pair
            await self._revoke_family(session.family_id)
            await self.db.commit()
            raise Unauthorized("refresh token reuse detected")
        if session.expires_at < now:
            raise Unauthorized("refresh token expired")
        session.revoked_at = now
        replacement, pair = self._new_session(
            session.user_id, family_id=session.family_id, device=session.device
        )
        await self.db.flush()
        session.replay_attempt_id = attempt_id
        session.replay_session_id = replacement.id
        session.replay_expires_at = now + timedelta(minutes=5)
        session.replay_ciphertext = (
            refresh_cipher().encrypt(pair.model_dump_json().encode()).decode()
        )
        await self.db.commit()
        return pair

    async def revoke(self, refresh_token: str) -> None:
        session = await self._locked_session(refresh_token)
        if session is not None:
            await self._revoke_family(session.family_id)
            await self.db.commit()

    async def _revoke_family(self, family_id: str) -> None:
        await self.db.execute(
            update(AuthSession)
            .where(AuthSession.family_id == family_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

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
        user = await self.db.get(User, tok.user_id, with_for_update=True)
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
        user = await self.db.get(User, tok.user_id, with_for_update=True)
        if user is None:
            raise Unauthorized("invalid token")
        user.email_verified_at = datetime.now(UTC)
        await self.db.commit()


async def run_prune_refreshes(db: AsyncSession, now: datetime) -> int:
    ids = list(
        await db.scalars(
            select(AuthSession.id)
            .where(AuthSession.replay_expires_at <= now, AuthSession.replay_ciphertext.is_not(None))
            .order_by(AuthSession.replay_expires_at, AuthSession.id)
            .limit(1000)
            .with_for_update(skip_locked=True)
        )
    )
    if ids:
        await db.execute(
            update(AuthSession).where(AuthSession.id.in_(ids)).values(replay_ciphertext=None)
        )
    await db.commit()
    return len(ids)
