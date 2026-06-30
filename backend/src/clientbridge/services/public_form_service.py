from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.identity import Business
from clientbridge.schemas.forms import (
    PublicFormContext,
    PublicFormField,
    PublicFormSubmit,
)


class PublicFormService:
    """The unauthenticated form surface (#4), like PublicReview. The opaque response token is the
    only credential; it resolves one pending response, so no principal/tenant scope is involved.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[FormResponse, Form, Business]:
        response = (
            await self.db.execute(select(FormResponse).where(FormResponse.token == token))
        ).scalar_one_or_none()
        if response is None:
            raise NotFound("form link not found")
        form = await self.db.get(Form, response.form_id)
        business = await self.db.get(Business, response.business_id)
        if form is None or business is None:
            raise NotFound("form link not found")
        return response, form, business

    async def _fields(self, form_id: str) -> list[FormField]:
        return list(
            (
                await self.db.execute(
                    select(FormField)
                    .where(FormField.form_id == form_id)
                    .order_by(FormField.position)
                )
            )
            .scalars()
            .all()
        )

    async def context(self, token: str) -> PublicFormContext:
        response, form, business = await self._resolve(token)
        fields = await self._fields(form.id)
        return PublicFormContext(
            form_name=form.name,
            business_name=business.name,
            completed=response.status == "submitted",
            fields=[_field_out(f) for f in fields],
        )

    async def submit(self, token: str, data: PublicFormSubmit) -> PublicFormContext:
        response, form, business = await self._resolve(token)
        if response.status == "submitted":
            raise Conflict("this form was already submitted")
        fields = await self._fields(form.id)
        _validate(fields, data.answers)
        response.status = "submitted"
        response.answers = data.answers
        response.submitted_at = datetime.now(UTC)
        await self.db.commit()
        return PublicFormContext(
            form_name=form.name,
            business_name=business.name,
            completed=True,
            fields=[_field_out(f) for f in fields],
        )


def _validate(fields: list[FormField], answers: dict[str, object]) -> None:
    for field in fields:
        if not field.required:
            continue
        value = answers.get(field.name)
        if value is None or (isinstance(value, str | list) and len(value) == 0):
            raise Unprocessable(f"missing required field: {field.name}")


def _field_out(field: FormField) -> PublicFormField:
    return PublicFormField(
        id=field.id,
        type=field.type,
        name=field.name,
        label=field.label,
        help=field.help,
        required=field.required,
        options=field.options,
        validation=field.validation,
        position=field.position,
    )
