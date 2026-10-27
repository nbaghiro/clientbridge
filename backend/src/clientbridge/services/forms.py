import re
import secrets
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_can_act_as, assert_role, is_manager
from clientbridge.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.forms import (
    FormAnswersOut,
    FormDefinition,
    FormFieldIn,
    FormOut,
    FormResponseOut,
    FormSave,
    FormSend,
    PublicFormField,
    TreatmentNoteCreate,
    TreatmentNoteOut,
    TreatmentNotes,
)
from clientbridge.services.business import staff_names
from clientbridge.services.deliveries import delivery_key
from clientbridge.services.notifications import Notifier, Outcome, queued_notifier
from clientbridge.services.plans import serving

_CHOICE_INPUTS = ("select", "multiselect")
# answers staff can't give on a note: there is no upload or signing step for one
_UNANSWERABLE = ("file", "image", "signature")


class FormService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_form(self, data: FormSend, idempotency_key: str | None) -> FormResponseOut:
        self._assert_admin()
        form = await self._form(data.form_id)
        await self._client(data.client_id)

        async def run(cmd: Command) -> FormResponseOut:
            response = FormResponse(
                id=new_id("form_response"),
                business_id=self.biz,
                form_id=data.form_id,
                client_id=data.client_id,
                definition=await snapshot_form(self.db, form),
                status="draft",
                token=secrets.token_urlsafe(16),
            )
            self.db.add(response)
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise Conflict("could not mint a unique form link") from exc
            cmd.record("form.send", entity_type="form_response", entity_id=response.id)
            await queued_notifier(
                self.db, self.biz, delivery_key("form", response.id)
            ).on_form_sent(self.db, response.id)
            return _response_out(response)

        return await run_command(
            self.db,
            self.principal,
            action="form.send",
            run=run,
            response_model=FormResponseOut,
            idempotency_key=idempotency_key,
            request=data,
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
            request=data,
        )

    async def update_form(self, form_id: str, data: FormSave) -> FormOut:
        """Replace the name, send rule and ordered questions; kept questions keep their answers."""
        self._assert_admin()
        _check_fields(data.fields)
        form = await self._form(form_id)
        await self.db.refresh(form, with_for_update=True)

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


class TreatmentNoteService:
    """Staff notes on a visit, written with a manual form: final, unsynced, read with an audit."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def write(
        self, data: TreatmentNoteCreate, idempotency_key: str | None
    ) -> TreatmentNoteOut:
        booking = await self._booking(data.booking_id)
        assert_can_act_as(self.principal, booking.staff_id)
        form = (
            await self.db.execute(scoped(Form, self.biz).where(Form.id == data.form_id))
        ).scalar_one_or_none()
        if form is None:
            raise NotFound("form not found")
        if not form.active or form.send_on != "manual":
            raise Unprocessable(
                "only an active form sent by hand can be filled in on a visit",
                code="form_not_fillable",
            )
        if data.amends is not None:
            await self._note(data.amends, booking.id)

        async def run(cmd: Command) -> TreatmentNoteOut:
            definition = await snapshot_form(self.db, form)
            fields = FormDefinition.model_validate(definition).fields
            if any(f.input in _UNANSWERABLE and f.name in data.answers for f in fields):
                raise Unprocessable("a note can't hold a file or a signature")
            validate_answers(fields, data.answers)
            now = clock.now()
            name = (await staff_names(self.db, self.biz, [self.principal.staff_id])).get(
                self.principal.staff_id
            )
            note = FormResponse(
                id=new_id("form_response"),
                business_id=self.biz,
                form_id=form.id,
                client_id=booking.client_id,
                parent_type="booking",
                parent_id=booking.id,
                token=None,
                status="submitted",
                submitted_at=now,
                definition=definition,
                answers=data.answers,
                signature={
                    "user_id": self.principal.user_id,
                    "staff_id": self.principal.staff_id,
                    "name": name,
                    "signed_at": now.isoformat(),
                    "amends": data.amends,
                },
            )
            self.db.add(note)
            await self.db.flush()
            cmd.record("treatment.write", entity_type="form_response", entity_id=note.id)
            return (await self._out([note]))[0]

        return await run_command(
            self.db,
            self.principal,
            action="treatment.write",
            run=run,
            response_model=TreatmentNoteOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def for_booking(self, booking_id: str) -> TreatmentNotes:
        booking = await self._booking(booking_id)
        assert_can_act_as(self.principal, booking.staff_id)
        return await self._read(FormResponse.parent_id == booking.id)

    async def for_client(self, client_id: str) -> TreatmentNotes:
        """Every note on the client's visits that the reader may see, oldest first."""
        client = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if client is None:
            raise NotFound("client not found")
        return await self._read(FormResponse.client_id == client.id)

    async def response(self, response_id: str) -> FormAnswersOut:
        """One submitted response: a client's form for managers, or a treatment note."""
        row = (
            await self.db.execute(
                scoped(FormResponse, self.biz).where(
                    FormResponse.id == response_id, FormResponse.status == "submitted"
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("response not found")
        if row.token is None:
            if not self._may_read(row):
                raise Forbidden("only the note's author or a manager can read it")
            return (await self._audited([row]))[0]
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can read form answers"
        )
        return _answers_out(row)

    def _may_read(self, note: FormResponse) -> bool:
        return is_manager(self.principal.role) or _author(note) == self.principal.staff_id

    async def _read(self, *criteria: ColumnElement[bool]) -> TreatmentNotes:
        rows = (
            await self.db.execute(
                scoped(FormResponse, self.biz)
                .where(
                    FormResponse.parent_type == "booking",
                    FormResponse.token.is_(None),
                    FormResponse.status == "submitted",
                    *criteria,
                )
                .order_by(FormResponse.created_at, FormResponse.id)
            )
        ).scalars()
        return TreatmentNotes(notes=await self._audited([r for r in rows if self._may_read(r)]))

    async def _audited(self, notes: list[FormResponse]) -> list[TreatmentNoteOut]:
        """The notes as read, with one audit entry per note committed alongside the read."""
        if not notes:
            return []

        async def run(cmd: Command) -> TreatmentNotes:
            for note in notes:
                cmd.record("treatment.read", entity_type="form_response", entity_id=note.id)
            return TreatmentNotes(notes=await self._out(notes))

        result = await run_command(
            self.db, self.principal, action="treatment.read", run=run, response_model=TreatmentNotes
        )
        return result.notes

    async def _out(self, notes: list[FormResponse]) -> list[TreatmentNoteOut]:
        ids = {n.parent_id for n in notes if n.parent_id is not None}
        visits = {
            booking_id: (starts_at, service)
            for booking_id, starts_at, service in (
                await self.db.execute(
                    scoped(Booking, self.biz)
                    .with_only_columns(Booking.id, Slot.starts_at, Item.name)
                    .join(Slot, Slot.id == Booking.slot_id)
                    .join(Item, Item.id == Slot.item_id)
                    .where(Booking.id.in_(ids))
                )
            ).tuples()
        }
        out: list[TreatmentNoteOut] = []
        for note in notes:
            visit_at, service = visits[note.parent_id or ""]
            out.append(
                TreatmentNoteOut(
                    **_answers_out(note).model_dump(),
                    booking_id=note.parent_id or "",
                    visit_at=visit_at,
                    service=service,
                )
            )
        return out

    async def _booking(self, booking_id: str) -> Booking:
        row = (
            await self.db.execute(
                scoped(Booking, self.biz, soft_delete=True).where(Booking.id == booking_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("booking not found")
        return row

    async def _note(self, note_id: str, booking_id: str) -> FormResponse:
        row = (
            await self.db.execute(
                scoped(FormResponse, self.biz).where(
                    FormResponse.id == note_id,
                    FormResponse.parent_type == "booking",
                    FormResponse.parent_id == booking_id,
                    FormResponse.token.is_(None),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("note not found on this visit")
        return row


def _signed(response: FormResponse, key: str) -> str | None:
    value = (response.signature or {}).get(key)
    return value if isinstance(value, str) else None


def _author(note: FormResponse) -> str | None:
    return _signed(note, "staff_id")


def _answers_out(response: FormResponse) -> FormAnswersOut:
    definition = FormDefinition.model_validate(response.definition)
    note = response.token is None
    return FormAnswersOut(
        id=response.id,
        form_id=response.form_id,
        form_name=definition.name,
        client_id=response.client_id,
        parent_type=response.parent_type,
        parent_id=response.parent_id,
        submitted_at=response.submitted_at,
        fields=definition.fields,
        answers=response.answers,
        author_staff_id=_author(response) if note else None,
        author_name=_signed(response, "name") if note else None,
        signer_name=None if note else _signed(response, "name"),
        amends=_signed(response, "amends") if note else None,
    )


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
                position=f.position,
            )
            for f in fields
        ],
    )


_INTAKE_WINDOW = timedelta(days=1)


async def run_intake_forms(db: AsyncSession, notifier: Notifier, now: datetime) -> int:
    """Send each "on booking" form once to every client whose first booking came in today."""
    forms = (
        (
            await db.execute(
                select(Form).where(
                    Form.active,
                    Form.send_on == "booking",
                    Form.business_id.in_(select(Business.id).where(serving(now))),
                )
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for form in forms:
        already = select(FormResponse.client_id).where(
            FormResponse.form_id == form.id, FormResponse.client_id.is_not(None)
        )
        returning = (
            scoped(Booking, form.business_id)
            .with_only_columns(Booking.client_id)
            .where(Booking.created_at < now - _INTAKE_WINDOW)
        )
        first_bookings = (
            await db.execute(
                scoped(Booking, form.business_id)
                .with_only_columns(Booking.client_id, func.min(Booking.id))
                .where(
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
                definition=await snapshot_form(db, form),
                client_id=client_id,
                parent_type="booking",
                parent_id=booking_id,
                status="draft",
                token=secrets.token_urlsafe(16),
            )
            db.add(response)
            await db.flush()
            if await notifier.on_form_sent(db, response.id) is Outcome.FAILED:
                # without its response row the client stays eligible for the next run
                await db.delete(response)
            else:
                sent += 1
            await db.commit()
    return sent


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


def form_definition(
    form: Form, fields: list[FormField], provenance: Literal["issued", "reconstructed"] = "issued"
) -> dict[str, object]:
    return FormDefinition(
        provenance=provenance,
        name=form.name,
        require_signature=bool(form.require_signature),
        fields=[
            PublicFormField(
                id=f.id,
                input=f.input,
                name=f.name,
                label=f.label,
                help=f.help,
                required=bool(f.required),
                options=f.options or [],
                position=f.position or 0,
            )
            for f in sorted(fields, key=lambda f: f.position or 0)
        ],
    ).model_dump(mode="json")


async def snapshot_form(db: AsyncSession, form: Form) -> dict[str, object]:
    await db.refresh(form, with_for_update={"read": True})
    fields = list(
        await db.scalars(scoped(FormField, form.business_id).where(FormField.form_id == form.id))
    )
    return form_definition(form, fields)


def validate_answers(
    fields: Sequence[FormField | PublicFormField], answers: dict[str, object]
) -> None:
    if answers.keys() - {field.name for field in fields}:
        raise Unprocessable("answers contain an unknown field")
    for field in fields:
        value = answers.get(field.name)
        missing = value is None or value == [] or (isinstance(value, str) and not value.strip())
        if missing:
            if field.required:
                raise Unprocessable(f"missing required field: {field.name}")
            continue
        valid = True
        if field.input == "checkbox":
            valid = isinstance(value, bool) and (not field.required or value)
        elif field.input in ("number", "currency", "rating"):
            valid = _valid_numeric_answer(field, value)
        elif field.input == "multiselect":
            valid = isinstance(value, list) and all(
                isinstance(option, str) and option in _form_options(field) for option in value
            )
        else:
            valid = isinstance(value, str) and len(value) <= 40000
            if valid and isinstance(value, str):
                if field.input == "select":
                    valid = value in _form_options(field)
                elif field.input == "email":
                    valid = re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) is not None
                elif field.input in ("date", "time"):
                    try:
                        if field.input == "date":
                            valid = date.fromisoformat(value).isoformat() == value
                        else:
                            valid = time.fromisoformat(value).tzinfo is None
                    except ValueError:
                        valid = False
        if not valid:
            raise Unprocessable(f"invalid answer for field: {field.name}")


def _form_options(field: FormField | PublicFormField) -> set[str]:
    return {
        str(option.get("value", "")) if isinstance(option, dict) else str(option)
        for option in field.options
    }


def _valid_numeric_answer(field: FormField | PublicFormField, value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        return False
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        return False
    if not number.is_finite():
        return False
    return field.input != "rating" or (number == number.to_integral_value() and 1 <= number <= 5)
