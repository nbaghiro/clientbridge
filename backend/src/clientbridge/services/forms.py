import re
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Client
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.scheduling import Booking
from clientbridge.schemas.forms import (
    FormFieldIn,
    FormOut,
    FormResponseOut,
    FormSave,
    FormSend,
    PublicFormField,
)
from clientbridge.services.notifications import Notifier

_CHOICE_INPUTS = ("select", "multiselect")


class FormService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_form(
        self, data: FormSend, idempotency_key: str | None, notify: Notifier
    ) -> FormResponseOut:
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
            # Inside the command so a same-key retry replays the response without re-notifying.
            await notify.on_form_sent(self.db, response.id)
            return _response_out(response)

        return await run_command(
            self.db,
            self.principal,
            action="form.send",
            run=run,
            response_model=FormResponseOut,
            idempotency_key=idempotency_key,
        )

    async def create_form(self, data: FormSave, idempotency_key: str | None) -> FormOut:
        self._assert_admin()
        _check_fields(data.fields)

        async def run(cmd: Command) -> FormOut:
            form = Form(id=new_id("form"), business_id=self.biz, name=data.name.strip())
            _apply(form, data)
            self.db.add(form)
            await self.db.flush()
            fields = await self._replace_fields(form, data.fields)
            cmd.record("form.create", entity_type="form", entity_id=form.id)
            return _form_out(form, fields)

        return await run_command(
            self.db,
            self.principal,
            action="form.create",
            run=run,
            response_model=FormOut,
            idempotency_key=idempotency_key,
        )

    async def update_form(self, form_id: str, data: FormSave) -> FormOut:
        """Replace the name, send rule and ordered questions; kept questions keep their answers."""
        self._assert_admin()
        _check_fields(data.fields)
        form = await self._form(form_id)

        async def run(cmd: Command) -> FormOut:
            _apply(form, data)
            fields = await self._replace_fields(form, data.fields)
            cmd.record("form.update", entity_type="form", entity_id=form.id)
            return _form_out(form, fields)

        return await run_command(
            self.db, self.principal, action="form.update", run=run, response_model=FormOut
        )

    async def _replace_fields(self, form: Form, incoming: list[FormFieldIn]) -> list[FormField]:
        existing = {
            f.id: f
            for f in (
                await self.db.execute(
                    scoped(FormField, self.biz).where(FormField.form_id == form.id)
                )
            )
            .scalars()
            .all()
        }
        kept = {f.id for f in incoming if f.id is not None and f.id in existing}
        gone = [fid for fid in existing if fid not in kept]
        if gone:
            await self.db.execute(delete(FormField).where(FormField.id.in_(gone)))
        names = {existing[fid].name for fid in kept}
        out: list[FormField] = []
        for position, data in enumerate(incoming):
            row = existing.get(data.id) if data.id is not None else None
            if row is None:
                row = FormField(
                    id=new_id("form_field"),
                    business_id=self.biz,
                    form_id=form.id,
                    name=_unique_name(data.label, names),
                )
                names.add(row.name)
                self.db.add(row)
            row.input = data.input
            row.label = data.label.strip()
            row.help = (data.help or "").strip() or None
            row.required = data.required
            row.options = _options(data)
            row.validation = {}
            row.position = position
            out.append(row)
        await self.db.flush()
        return out

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


def _apply(form: Form, data: FormSave) -> None:
    form.name = data.name.strip()
    form.require_signature = data.require_signature
    form.send_on = data.send_on
    form.active = data.active


def _options(data: FormFieldIn) -> list[object]:
    return [o.strip() for o in data.options if o.strip()] if data.input in _CHOICE_INPUTS else []


def _check_fields(fields: list[FormFieldIn]) -> None:
    for field in fields:
        if field.label.strip() == "":
            raise Unprocessable("every question needs a label")
        if field.input in _CHOICE_INPUTS and len(_options(field)) < 2:
            raise Unprocessable(f'give "{field.label.strip()}" at least two choices')


def _unique_name(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40] or "question"
    name, n = base, 2
    while name in taken:
        name, n = f"{base}_{n}", n + 1
    return name


def _form_out(form: Form, fields: list[FormField]) -> FormOut:
    return FormOut(
        id=form.id,
        name=form.name,
        require_signature=form.require_signature,
        send_on=form.send_on,
        active=form.active,
        fields=[
            PublicFormField(
                id=f.id,
                input=f.input,
                name=f.name,
                label=f.label,
                help=f.help,
                required=f.required,
                options=f.options,
                validation=f.validation,
                position=f.position,
            )
            for f in fields
        ],
    )


_INTAKE_WINDOW = timedelta(days=1)


async def run_intake_forms(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Send each "on booking" form once to every client whose first booking came in today."""
    forms = (
        (await db.execute(select(Form).where(Form.active, Form.send_on == "booking")))
        .scalars()
        .all()
    )
    sent: list[FormResponse] = []
    for form in forms:
        already = select(FormResponse.client_id).where(
            FormResponse.form_id == form.id, FormResponse.client_id.is_not(None)
        )
        returning = select(Booking.client_id).where(
            Booking.business_id == form.business_id, Booking.created_at < now - _INTAKE_WINDOW
        )
        first_bookings = (
            await db.execute(
                select(Booking.client_id, func.min(Booking.id))
                .where(
                    Booking.business_id == form.business_id,
                    Booking.deleted_at.is_(None),
                    Booking.status != "canceled",
                    Booking.created_at >= now - _INTAKE_WINDOW,
                    Booking.client_id.not_in(already),
                    Booking.client_id.not_in(returning),
                )
                .group_by(Booking.client_id)
            )
        ).all()
        for client_id, booking_id in first_bookings:
            response = FormResponse(
                id=new_id("form_response"),
                business_id=form.business_id,
                form_id=form.id,
                client_id=client_id,
                parent_type="booking",
                parent_id=booking_id,
                status="draft",
                token=secrets.token_urlsafe(16),
            )
            db.add(response)
            sent.append(response)
    await db.flush()
    for response in sent:
        await notifier.on_form_sent(db, response.id)
    await db.commit()
    return len(sent)


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
