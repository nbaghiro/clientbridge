from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict, NotFound, Unprocessable
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.documents import Form, FormField, FormResponse
from clientbridge.models.identity import Business
from clientbridge.schemas.files import PublicFileCreate, PublicFileUpload
from clientbridge.schemas.forms import (
    PublicFormContext,
    PublicFormField,
    PublicFormSubmit,
)
from clientbridge.services.file_service import mint_upload
from clientbridge.services.public_common import business_or_404, public_brand, resolve_by_token


class PublicFormService:
    """The unauthenticated form surface (#4), like PublicReview. The opaque response token is the
    only credential; it resolves one pending response, so no principal/tenant scope is involved.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[FormResponse, Form, Business]:
        response = await resolve_by_token(
            self.db, FormResponse, FormResponse.token == token, "form link not found"
        )
        form = await self.db.get(Form, response.form_id)
        if form is None:
            raise NotFound("form link not found")
        business = await business_or_404(self.db, response.business_id, "form link not found")
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
            brand=public_brand(business),
            completed=response.status == "submitted",
            fields=[_field_out(f) for f in fields],
        )

    async def upload(
        self, token: str, data: PublicFileCreate, storage: FileStorage
    ) -> PublicFileUpload:
        response, _, _ = await self._resolve(token)
        result = await mint_upload(
            self.db,
            storage,
            business_id=response.business_id,
            parent_type="form_response",
            parent_id=response.id,
            kind="attachment",
            content_type=data.content_type,
            size=data.size,
        )
        await self.db.commit()
        return PublicFileUpload(file_id=result.file.id, upload_url=result.upload_url)

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
            brand=public_brand(business),
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
