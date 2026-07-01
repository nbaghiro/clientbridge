import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.crm import Client
from clientbridge.models.documents import Contract, Signature
from clientbridge.schemas.contracts import ContractSend, SignatureOut


class ContractService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_contract(self, data: ContractSend, idempotency_key: str | None) -> SignatureOut:
        self._assert_admin()
        await self._contract(data.contract_id)
        await self._client(data.client_id)

        async def run(cmd: Command) -> SignatureOut:
            signature = Signature(
                id=new_id("signature"),
                business_id=self.biz,
                contract_id=data.contract_id,
                client_id=data.client_id,
                status="pending",
                token=secrets.token_urlsafe(16),
            )
            self.db.add(signature)
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise Conflict("could not mint a unique signing link") from exc
            cmd.record("contract.send", entity_type="signature", entity_id=signature.id)
            return _signature_out(signature)

        return await run_command(
            self.db,
            self.principal,
            action="contract.send",
            run=run,
            response_model=SignatureOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        assert_role(
            self.principal, "owner", "admin", message="only an owner or admin can send contracts"
        )

    async def _contract(self, contract_id: str) -> Contract:
        row = (
            await self.db.execute(scoped(Contract, self.biz).where(Contract.id == contract_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("contract not found")
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


def _signature_out(signature: Signature) -> SignatureOut:
    assert signature.token is not None
    return SignatureOut(
        id=signature.id,
        business_id=signature.business_id,
        contract_id=signature.contract_id,
        client_id=signature.client_id,
        status=signature.status,
        token=signature.token,
        signed_at=signature.signed_at,
    )
