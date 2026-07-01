import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.crm import Client
from clientbridge.models.documents import Form, FormResponse
from clientbridge.schemas.forms import FormResponseOut, FormSend


class FormService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_form(self, data: FormSend, idempotency_key: str | None) -> FormResponseOut:
        self._assert_admin()
        await self._form(data.form_id)
        await self._client(data.client_id)

        async def run(cmd: Command) -> FormResponseOut:
            response = FormResponse(
                id=new_id("form_response"),
                business_id=self.biz,
                form_id=data.form_id,
                client_id=data.client_id,
                status="draft",
                token=secrets.token_urlsafe(16),
            )
            self.db.add(response)
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise Conflict("could not mint a unique form link") from exc
            cmd.record("form.send", entity_type="form_response", entity_id=response.id)
            return _response_out(response)

        return await run_command(
            self.db,
            self.principal,
            action="form.send",
            run=run,
            response_model=FormResponseOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can send forms"
        )

    async def _form(self, form_id: str) -> Form:
        row = (
            await self.db.execute(scoped(Form, self.biz).where(Form.id == form_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("form not found")
        return row

    async def _client(self, client_id: str) -> Client:
        row = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("client not found")
        return row


def _response_out(response: FormResponse) -> FormResponseOut:
    assert response.token is not None
    return FormResponseOut(
        id=response.id,
        business_id=response.business_id,
        form_id=response.form_id,
        client_id=response.client_id,
        status=response.status,
        token=response.token,
        submitted_at=response.submitted_at,
    )
