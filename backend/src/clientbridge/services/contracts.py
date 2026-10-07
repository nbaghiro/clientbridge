import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal, assert_role
from clientbridge.core.errors import Conflict, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.clients import Client
from clientbridge.models.documents import Contract, Signature
from clientbridge.schemas.contracts import (
    ContractCreate,
    ContractOut,
    ContractSend,
    ContractVersionCreate,
    SignatureOut,
)
from clientbridge.services.notifications import Notifier


class ContractService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def send_contract(
        self, data: ContractSend, idempotency_key: str | None, notify: Notifier
    ) -> SignatureOut:
        self._assert_admin()
        contract = await self._contract(data.contract_id)
        await self._client(data.client_id)

        async def run(cmd: Command) -> SignatureOut:
            signature = Signature(
                id=new_id("signature"),
                business_id=self.biz,
                contract_id=data.contract_id,
                client_id=data.client_id,
                status="pending",
                token=secrets.token_urlsafe(16),
                contract_version=contract.version,
            )
            self.db.add(signature)
            try:
                await self.db.flush()
            except IntegrityError as exc:
                raise Conflict("could not mint a unique signing link") from exc
            cmd.record("contract.send", entity_type="signature", entity_id=signature.id)
            # Inside the command so a same-key retry replays the response without re-notifying.
            await notify.on_contract_sent(self.db, signature.id)
            return _signature_out(signature)

        return await run_command(
            self.db,
            self.principal,
            action="contract.send",
            run=run,
            response_model=SignatureOut,
            idempotency_key=idempotency_key,
        )

    async def create_contract(
        self, data: ContractCreate, idempotency_key: str | None
    ) -> ContractOut:
        self._assert_admin()

        async def run(cmd: Command) -> ContractOut:
            contract = Contract(
                id=new_id("contract"),
                business_id=self.biz,
                name=data.name.strip(),
                body=data.body.strip(),
                version=1,
            )
            self.db.add(contract)
            await self.db.flush()
            cmd.record("contract.create", entity_type="contract", entity_id=contract.id)
            return _contract_out(contract)

        return await run_command(
            self.db,
            self.principal,
            action="contract.create",
            run=run,
            response_model=ContractOut,
            idempotency_key=idempotency_key,
        )

    async def publish_version(
        self, contract_id: str, data: ContractVersionCreate, idempotency_key: str | None
    ) -> ContractOut:
        """New text is a new version; a signed copy keeps the text and version it was signed at."""
        self._assert_admin()
        contract = await self._contract(contract_id)
        if data.body.strip() == contract.body.strip():
            raise Conflict("the text hasn't changed")

        async def run(cmd: Command) -> ContractOut:
            contract.body = data.body.strip()
            contract.version += 1
            await self.db.flush()
            cmd.record(
                "contract.version",
                entity_type="contract",
                entity_id=contract.id,
                changes={"version": contract.version},
            )
            return _contract_out(contract)

        return await run_command(
            self.db,
            self.principal,
            action="contract.version",
            run=run,
            response_model=ContractOut,
            idempotency_key=idempotency_key,
        )

    async def resend(
        self, signature_id: str, idempotency_key: str | None, notify: Notifier
    ) -> SignatureOut:
        self._assert_admin()
        signature = (
            await self.db.execute(scoped(Signature, self.biz).where(Signature.id == signature_id))
        ).scalar_one_or_none()
        if signature is None:
            raise NotFound("signature request not found")
        if signature.status != "pending":
            raise Conflict("only a request still waiting for a signature can be resent")

        async def run(cmd: Command) -> SignatureOut:
            cmd.record("contract.resend", entity_type="signature", entity_id=signature.id)
            await notify.on_contract_sent(self.db, signature.id)
            return _signature_out(signature)

        return await run_command(
            self.db,
            self.principal,
            action="contract.resend",
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


def _contract_out(contract: Contract) -> ContractOut:
    return ContractOut(
        id=contract.id,
        name=contract.name,
        body=contract.body,
        version=contract.version,
        active=contract.active,
    )


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
        contract_version=signature.contract_version,
    )
