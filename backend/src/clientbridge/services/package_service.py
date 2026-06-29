from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.config import get_settings
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.integrations.payments import PaymentGateway
from clientbridge.models.catalog import Item, Package
from clientbridge.models.crm import Client
from clientbridge.models.identity import Business
from clientbridge.schemas.packages import PackageOut, PackagePurchase, PackagePurchaseOut
from clientbridge.services.lines import tax_for_amount
from clientbridge.services.payment_service import open_entitlement_payment, resolve_saved_method_ref


class PackageService:
    def __init__(self, db: AsyncSession, principal: Principal, gateway: PaymentGateway) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id
        self.gateway = gateway

    async def purchase_package(
        self, data: PackagePurchase, idempotency_key: str | None = None
    ) -> PackagePurchaseOut:
        self._assert_admin()
        client = await self._client(data.client_id)
        item = await self._item(data.item_id)
        if item.kind != "package":
            raise Conflict("item is not a package")
        if item.session_count is None:
            raise AppError(
                "package item has no session count", status_code=422, code="invalid_package"
            )
        sessions_total = item.session_count
        business = await self._business()
        if not business.stripe_charges_enabled or business.stripe_account_id is None:
            raise Conflict("connect your Stripe account before taking payments")
        account_id = business.stripe_account_id
        amount = (await tax_for_amount(self.db, self.biz, item.price_cents)).total_cents
        fee_bps = get_settings().platform_fee_bps
        pm_ref = await resolve_saved_method_ref(
            self.db, self.biz, data.payment_method_id, data.client_id
        )

        async def run(cmd: Command) -> PackagePurchaseOut:
            package_id = new_id("package")
            payment, client_secret = await open_entitlement_payment(
                self.db,
                self.gateway,
                account_id=account_id,
                business_id=self.biz,
                client=client,
                amount=amount,
                currency=item.currency,
                fee_bps=fee_bps,
                entitlement_kind="package",
                entitlement_id=package_id,
                payment_method=pm_ref,
                idempotency_key=idempotency_key,
            )
            package = Package(
                id=package_id,
                business_id=self.biz,
                client_id=data.client_id,
                item_id=item.id,
                sessions_total=sessions_total,
                sessions_used=0,
                status="pending",
                payment_id=payment.id,
            )
            self.db.add(package)
            await self.db.flush()
            cmd.record("package.purchase", entity_type="package", entity_id=package.id)
            return PackagePurchaseOut(
                package_id=package.id, payment_id=payment.id, client_secret=client_secret
            )

        return await run_command(
            self.db,
            self.principal,
            action="package.purchase",
            run=run,
            response_model=PackagePurchaseOut,
            idempotency_key=idempotency_key,
        )

    async def consume_session(
        self, package_id: str, idempotency_key: str | None = None
    ) -> PackageOut:
        self._assert_admin()
        package = await self._package(package_id)

        async def run(cmd: Command) -> PackageOut:
            if package.status != "active":
                raise Conflict("only an active package can be consumed")
            if package.sessions_used >= package.sessions_total:
                raise Conflict("no sessions left on this package")
            package.sessions_used += 1
            if package.sessions_used >= package.sessions_total:
                package.status = "used"
            await self.db.flush()
            cmd.record("package.consume", entity_type="package", entity_id=package.id)
            return _out(package)

        return await run_command(
            self.db,
            self.principal,
            action="package.consume",
            run=run,
            response_model=PackageOut,
            idempotency_key=idempotency_key,
        )

    def _assert_admin(self) -> None:
        if self.principal.role not in ("owner", "admin"):
            raise Forbidden("only an owner or admin can manage packages")

    async def _business(self) -> Business:
        row = await self.db.get(Business, self.biz)
        if row is None:
            raise NotFound("business not found")
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

    async def _item(self, item_id: str) -> Item:
        row = (
            await self.db.execute(scoped(Item, self.biz).where(Item.id == item_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("item not found")
        return row

    async def _package(self, package_id: str) -> Package:
        row = (
            await self.db.execute(scoped(Package, self.biz).where(Package.id == package_id))
        ).scalar_one_or_none()
        if row is None:
            raise NotFound("package not found")
        return row


def _out(package: Package) -> PackageOut:
    return PackageOut(
        id=package.id,
        client_id=package.client_id,
        item_id=package.item_id,
        sessions_total=package.sessions_total,
        sessions_used=package.sessions_used,
        status=package.status,
    )
