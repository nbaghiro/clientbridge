from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.command import Command, run_command
from clientbridge.core.deps import Principal
from clientbridge.core.errors import AppError, Conflict, Forbidden, NotFound
from clientbridge.core.ids import new_id
from clientbridge.core.scoping import scoped
from clientbridge.models.catalog import Item, Package
from clientbridge.models.crm import Client
from clientbridge.schemas.packages import PackageOut, PackagePurchase


class PackageService:
    def __init__(self, db: AsyncSession, principal: Principal) -> None:
        self.db = db
        self.principal = principal
        self.biz = principal.business_id

    async def purchase_package(
        self, data: PackagePurchase, idempotency_key: str | None = None
    ) -> PackageOut:
        self._assert_admin()
        await self._client(data.client_id)
        item = await self._item(data.item_id)
        if item.kind != "package":
            raise Conflict("item is not a package")
        if item.session_count is None:
            raise AppError(
                "package item has no session count", status_code=422, code="invalid_package"
            )
        sessions_total = item.session_count

        async def run(cmd: Command) -> PackageOut:
            package = Package(
                id=new_id("package"),
                business_id=self.biz,
                client_id=data.client_id,
                item_id=item.id,
                sessions_total=sessions_total,
                sessions_used=0,
                status="active",
            )
            self.db.add(package)
            await self.db.flush()
            cmd.record("package.purchase", entity_type="package", entity_id=package.id)
            return _out(package)

        return await run_command(
            self.db,
            self.principal,
            action="package.purchase",
            run=run,
            response_model=PackageOut,
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
