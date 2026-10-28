from sqlalchemy import ColumnElement
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core import clock
from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_can_act_as, is_manager
from clientbridge.core.errors import Forbidden, NotFound, Unprocessable
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client
from clientbridge.models.documents import Form, VisitRecord
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.forms import FormDefinition
from clientbridge.schemas.visit_records import VisitRecordCreate, VisitRecordOut, VisitRecords
from clientbridge.services.business import staff_names
from clientbridge.services.forms import snapshot_form, validate_answers

# answers staff can't give on a record: there is no upload or signing step for one
_UNANSWERABLE = ("file", "image", "signature")


class VisitRecordService:
    """Staff records of a visit, written with a manual form: final, unsynced, read with an audit."""

    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def write(self, data: VisitRecordCreate, idempotency_key: str | None) -> VisitRecordOut:
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
            await self._amended(data.amends, booking.id)

        async def run(cmd: Command) -> VisitRecordOut:
            definition = await snapshot_form(self.db, form)
            fields = FormDefinition.model_validate(definition).fields
            if any(f.input in _UNANSWERABLE and f.name in data.answers for f in fields):
                raise Unprocessable("a visit record can't hold a file or a signature")
            validate_answers(fields, data.answers)
            now = clock.now()
            name = (await staff_names(self.db, self.biz, [self.principal.staff_id])).get(
                self.principal.staff_id
            )
            record = VisitRecord(
                id=new_id("visit_record"),
                business_id=self.biz,
                form_id=form.id,
                client_id=booking.client_id,
                booking_id=booking.id,
                definition=definition,
                answers=data.answers,
                signature={
                    "user_id": self.principal.user_id,
                    "staff_id": self.principal.staff_id,
                    "name": name,
                    "signed_at": now.isoformat(),
                    "amends": data.amends,
                },
                created_at=now,
                updated_at=now,
            )
            self.db.add(record)
            await self.db.flush()
            cmd.record("visit_record.write", entity_type="visit_record", entity_id=record.id)
            return (await self._out([record]))[0]

        return await run_command(
            self.db,
            self.principal,
            action="visit_record.write",
            run=run,
            response_model=VisitRecordOut,
            idempotency_key=idempotency_key,
            request=data,
        )

    async def for_booking(self, booking_id: str) -> VisitRecords:
        booking = await self._booking(booking_id)
        assert_can_act_as(self.principal, booking.staff_id)
        return await self._read(VisitRecord.booking_id == booking.id)

    async def for_client(self, client_id: str) -> VisitRecords:
        """Every record on the client's visits that the reader may see, oldest first."""
        client = (
            await self.db.execute(
                scoped(Client, self.biz, soft_delete=True).where(Client.id == client_id)
            )
        ).scalar_one_or_none()
        if client is None:
            raise NotFound("client not found")
        return await self._read(VisitRecord.client_id == client.id)

    async def one(self, record_id: str) -> VisitRecordOut:
        row = (
            await self.db.execute(scoped(VisitRecord, self.biz).where(VisitRecord.id == record_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("visit record not found")
        if not self._may_read(row):
            raise Forbidden("only the record's author or a manager can read it")
        return (await self._audited([row]))[0]

    def _may_read(self, record: VisitRecord) -> bool:
        return is_manager(self.principal.role) or _signed(record, "staff_id") == (
            self.principal.staff_id
        )

    async def _read(self, *criteria: ColumnElement[bool]) -> VisitRecords:
        rows = (
            await self.db.execute(
                scoped(VisitRecord, self.biz)
                .where(*criteria)
                .order_by(VisitRecord.created_at, VisitRecord.id)
            )
        ).scalars()
        return VisitRecords(records=await self._audited([r for r in rows if self._may_read(r)]))

    async def _audited(self, records: list[VisitRecord]) -> list[VisitRecordOut]:
        """The records as read, with one audit entry per record committed alongside the read."""
        if not records:
            return []

        async def run(cmd: Command) -> VisitRecords:
            for record in records:
                cmd.record("visit_record.read", entity_type="visit_record", entity_id=record.id)
            return VisitRecords(records=await self._out(records))

        result = await run_command(
            self.db,
            self.principal,
            action="visit_record.read",
            run=run,
            response_model=VisitRecords,
        )
        return result.records

    async def _out(self, records: list[VisitRecord]) -> list[VisitRecordOut]:
        visits = {
            booking_id: (starts_at, service)
            for booking_id, starts_at, service in (
                await self.db.execute(
                    scoped(Booking, self.biz)
                    .with_only_columns(Booking.id, Slot.starts_at, Item.name)
                    .join(Slot, Slot.id == Booking.slot_id)
                    .join(Item, Item.id == Slot.item_id)
                    .where(Booking.id.in_({r.booking_id for r in records}))
                )
            ).tuples()
        }
        out: list[VisitRecordOut] = []
        for record in records:
            definition = FormDefinition.model_validate(record.definition)
            visit_at, service = visits[record.booking_id]
            out.append(
                VisitRecordOut(
                    id=record.id,
                    form_id=record.form_id,
                    form_name=definition.name,
                    client_id=record.client_id,
                    booking_id=record.booking_id,
                    visit_at=visit_at,
                    service=service,
                    written_at=record.created_at,
                    fields=definition.fields,
                    answers=record.answers,
                    author_staff_id=_signed(record, "staff_id"),
                    author_name=_signed(record, "name"),
                    amends=_signed(record, "amends"),
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

    async def _amended(self, record_id: str, booking_id: str) -> VisitRecord:
        row = (
            await self.db.execute(
                scoped(VisitRecord, self.biz).where(
                    VisitRecord.id == record_id, VisitRecord.booking_id == booking_id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("visit record not found on this visit")
        return row


def _signed(record: VisitRecord, key: str) -> str | None:
    value = record.signature.get(key)
    return value if isinstance(value, str) else None
