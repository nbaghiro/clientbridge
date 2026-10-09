"""Catalog image fixtures and a targeted refresh that preserves the rest of the demo."""

import asyncio
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

import httpx
from sqlalchemy import select

from clientbridge.core.db import SessionLocal, engine
from clientbridge.core.scoping import scoped
from clientbridge.integrations.s3 import get_file_storage
from clientbridge.models.business import Business
from clientbridge.models.catalog import Item, StockMovement
from clientbridge.models.platform import File
from scripts.demo_context import DemoContext

ASSETS = Path(__file__).parent / "demo_assets"


def add_catalog_images(ctx: DemoContext) -> None:
    for item in ctx.all(Item):
        asset_id = item.variant_parent_id or item.id
        path = ASSETS / f"{asset_id}.jpg"
        digest = sha256(path.read_bytes()).hexdigest()[:12]
        ctx.add(
            File(
                id=f"fl_img_{item.id}_{digest}",
                business_id=ctx.business_id,
                parent_type="item",
                parent_id=item.id,
                purpose="image",
                s3_key=f"{ctx.business_id}/demo/{digest}/{path.name}",
                content_type="image/jpeg",
                size=path.stat().st_size,
            )
        )


async def refresh_catalog() -> None:
    from scripts.seed_demo import BIZ, build_demo, validate_seed_target

    validate_seed_target(reset_demo=False)
    ctx = build_demo()
    images = [file for file in ctx.all(File) if file.parent_type == "item"]
    storage = get_file_storage()
    async with SessionLocal() as db, db.begin():
        business = await db.scalar(select(Business).where(Business.id == BIZ).with_for_update())
        if business is None or business.slug != "birchbark":
            raise ValueError("Expected the existing Birchbark demo business")
        items = {
            item.id: item for item in (await db.scalars(scoped(Item, BIZ).with_for_update())).all()
        }
        added = [item for item in ctx.all(Item) if item.kind == "product" and item.id not in items]
        for item in added:
            db.add(item)
            items[item.id] = item
        await db.flush()
        movements = {m.item_id: m for m in ctx.all(StockMovement) if m.id == f"mv_{m.item_id}"}
        for item in added:
            if item.id in movements:
                db.add(movements[item.id])
        for source in ctx.all(Item):
            if source.kind == "product" and source.id in items:
                items[source.id].category = source.category
                items[source.id].sell_online = source.sell_online
        if any(file.parent_id not in items for file in images):
            raise ValueError("Demo catalog is incomplete; no changes made")
        async with httpx.AsyncClient(timeout=30) as client:
            for image in images:
                existing = await db.get(File, image.id)
                if existing is not None:
                    if existing.business_id != BIZ or existing.s3_key != image.s3_key:
                        raise ValueError("Unexpected existing catalog file")
                    continue
                payload = (ASSETS / Path(image.s3_key).name).read_bytes()
                response = await client.put(
                    storage.presign_upload(image.s3_key, "image/jpeg"),
                    content=payload,
                    headers={"Content-Type": "image/jpeg"},
                )
                response.raise_for_status()
                image.created_at = datetime.now(UTC)
                image.updated_at = image.created_at
                db.add(image)
        for item_id in ("it_shampoo_travel", "it_shampoo_unscented"):
            source, target = ctx.get(Item, item_id), items[item_id]
            target.category = source.category
            target.description = source.description
            target.price_cents = source.price_cents
            target.cost_cents = source.cost_cents
            target.sku = source.sku
        movement = await db.scalar(
            scoped(StockMovement, BIZ).where(StockMovement.id == "mv_shampoo_unscented")
        )
        if movement is not None:
            movement.unit_cost_cents = ctx.get(StockMovement, movement.id).unit_cost_cents
    await engine.dispose()
    print(
        f"Refreshed {len(images)} catalog images, added {len(added)} products and aligned product "
        "categories; no demo reset."
    )


if __name__ == "__main__":
    asyncio.run(refresh_catalog())
