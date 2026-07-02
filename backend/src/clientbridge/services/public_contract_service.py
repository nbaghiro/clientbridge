from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.errors import Conflict, NotFound
from clientbridge.integrations.s3 import FileStorage
from clientbridge.models.crm import Client
from clientbridge.models.documents import Contract, Signature
from clientbridge.models.identity import Business
from clientbridge.models.platform import File
from clientbridge.schemas.contracts import PublicContractContext, PublicContractSign
from clientbridge.schemas.files import PublicFileCreate, PublicFileUpload
from clientbridge.services.file_service import mint_upload
from clientbridge.services.public_common import public_brand


class PublicContractService:
    """The unauthenticated e-sign surface (#4), like PublicReview. The opaque signature token is the
    only credential; it resolves one pending signature, so no principal/tenant scope is involved.
    Signing snapshots the contract body + captures the signer's IP for a durable legal record."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve(self, token: str) -> tuple[Signature, Contract, Business]:
        signature = (
            await self.db.execute(select(Signature).where(Signature.token == token))
        ).scalar_one_or_none()
        if signature is None:
            raise NotFound("signing link not found")
        contract = await self.db.get(Contract, signature.contract_id)
        business = await self.db.get(Business, signature.business_id)
        if contract is None or business is None:
            raise NotFound("signing link not found")
        return signature, contract, business

    async def context(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        client = await self.db.get(Client, signature.client_id)
        return PublicContractContext(
            contract_name=contract.name,
            business_name=business.name,
            brand=public_brand(business),
            body=signature.signed_body or contract.body,
            signer_name=client.name if client is not None else None,
            status=signature.status,
        )

    async def sign(self, token: str, data: PublicContractSign, ip: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        if data.signature_image_id is not None:
            await self._assert_image(data.signature_image_id, signature.business_id)
        signature.status = "signed"
        signature.signed_at = datetime.now(UTC)
        signature.signed_body = _snapshot(contract.body, data.typed_name)
        signature.signature_image_id = data.signature_image_id
        signature.ip = ip
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def upload(
        self, token: str, data: PublicFileCreate, storage: FileStorage
    ) -> PublicFileUpload:
        signature, _, _ = await self._resolve(token)
        result = await mint_upload(
            self.db,
            storage,
            business_id=signature.business_id,
            parent_type="signature",
            parent_id=signature.id,
            kind="signature",
            content_type=data.content_type,
            size=data.size,
        )
        await self.db.commit()
        return PublicFileUpload(file_id=result.file.id, upload_url=result.upload_url)

    async def decline(self, token: str) -> PublicContractContext:
        signature, contract, business = await self._resolve(token)
        if signature.status != "pending":
            raise Conflict("this contract is no longer awaiting a signature")
        signature.status = "declined"
        await self.db.commit()
        return await self._context(signature, contract, business)

    async def _context(
        self, signature: Signature, contract: Contract, business: Business
    ) -> PublicContractContext:
        client = await self.db.get(Client, signature.client_id)
        return PublicContractContext(
            contract_name=contract.name,
            business_name=business.name,
            brand=public_brand(business),
            body=signature.signed_body or contract.body,
            signer_name=client.name if client is not None else None,
            status=signature.status,
        )

    async def _assert_image(self, file_id: str, business_id: str) -> None:
        file = await self.db.get(File, file_id)
        if file is None or file.business_id != business_id:
            raise NotFound("signature image not found")


def _snapshot(body: str, typed_name: str | None) -> str:
    return f"{body}\n\n— Signed by {typed_name}" if typed_name else body
