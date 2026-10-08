from datetime import datetime

from clientbridge.models.base import TimestampMixin
from clientbridge.models.clients import Subject
from clientbridge.models.payments import Payment
from clientbridge.models.platform import Audit
from clientbridge.models.scheduling import Booking
from scripts.demo_context import DemoContext

PARENTS = {
    "client": "clients",
    "subject": "subjects",
    "booking": "bookings",
    "invoice": "invoices",
    "order": "orders",
    "item": "items",
    "business": "businesses",
    "contract": "contracts",
    "form": "forms",
    "signature": "signatures",
    "response": "responses",
}


def align_chronology(ctx: DemoContext) -> None:
    by_key = {(row.__tablename__, getattr(row, "id", None)): row for row in ctx.rows}
    for _ in range(10):
        changed = False
        for row in ctx.rows:
            if not isinstance(row, TimestampMixin):
                continue
            parents = [
                by_key.get((fk.column.table.name, getattr(row, column.name, None)))
                for column in row.__table__.c
                for fk in column.foreign_keys
                if column.name not in {"converted_invoice_id", "payment_id"}
            ]
            parent_type = getattr(row, "parent_type", None)
            if parent_type in PARENTS:
                parents.append(by_key.get((PARENTS[parent_type], getattr(row, "parent_id", None))))
            dates = [
                value
                for parent in parents
                if isinstance(value := getattr(parent, "created_at", None), datetime)
            ]
            when = max([row.created_at or ctx.at(-450), *dates])
            if row.created_at != when:
                row.created_at = when
                changed = True
            row.updated_at = max(row.updated_at or when, when)
        if not changed:
            break
    for audit in ctx.all(Audit):
        if audit.action == "booking.completed":
            audit.created_at = ctx.get(Booking, audit.entity_id).completed_at or audit.created_at
        elif audit.action == "invoice.paid":
            dates = [
                payment.paid_at
                for payment in ctx.all(Payment)
                if payment.invoice_id == audit.entity_id and payment.paid_at is not None
            ]
            audit.created_at = max(dates, default=audit.created_at)
    for index, pet in enumerate(ctx.all(Subject)):
        prior = str(pet.attributes.get("temperament", "friendly"))
        pet.attributes = {
            **pet.attributes,
            "sex": "female" if index % 2 == 0 else "male",
            "temperament": prior
            if prior in {"calm", "friendly", "energetic", "anxious", "reactive"}
            else "friendly",
            "coat": "Short coat"
            if pet.attributes.get("species") == "cat"
            else "Regular brushing required",
            "allergies": "None reported",
            "vet": "Island Animal Clinic (demo)",
            "style": f"{prior}. Discuss preferred trim at drop-off.",
        }
    ctx.get(Subject, "sj_pepper").attributes["rabies_until"] = ctx.at(14).date().isoformat()


def chronology_errors(ctx: DemoContext) -> list[str]:
    errors = []
    for row in ctx.rows:
        if not isinstance(row, TimestampMixin):
            continue
        for column in (
            "paid_at",
            "submitted_at",
            "signed_at",
            "completed_at",
            "accepted_at",
            "declined_at",
            "sent_at",
        ):
            event = getattr(row, column, None)
            if isinstance(event, datetime) and event < row.created_at:
                errors.append(
                    f"{row.__tablename__}/{getattr(row, 'id', '')}: {column} before creation"
                )
    return errors
