from clientbridge.models.catalog import Item, StockMovement
from clientbridge.models.clients import Client, Subject
from clientbridge.models.scheduling import Booking
from scripts.demo_context import DemoContext


def add_scenarios(ctx: DemoContext) -> None:
    ctx.add(
        Item(
            id="it_shampoo_travel",
            business_id=ctx.business_id,
            created_by=ctx.owner_id,
            kind="product",
            name="Travel Shampoo",
            price_cents=0,
            currency="CAD",
            active=True,
            sell_online=True,
            tax_class="standard",
        )
    )
    ctx.get(Item, "it_puppy").deposit_type = "percent"
    ctx.get(Item, "it_puppy").deposit_value = 50
    ctx.get(StockMovement, "mv_it_brush").quantity = 5
    ctx.get(StockMovement, "mv_it_shampoo").quantity = 26
    ctx.add(
        Item(
            id="it_shampoo_unscented",
            business_id=ctx.business_id,
            created_by=ctx.owner_id,
            kind="product",
            name="Travel Shampoo - 100 ml",
            variant_parent_id="it_shampoo_travel",
            variant_label="100 ml",
            price_cents=2400,
            currency="CAD",
            active=True,
            sku="BB-SHAMPOO-UNSCENTED",
            track_stock=True,
            stock_on_hand=18,
            low_stock_at=6,
            cost_cents=1100,
            sell_online=True,
            tax_class="standard",
        ),
        StockMovement(
            id="mv_shampoo_unscented",
            business_id=ctx.business_id,
            item_id="it_shampoo_unscented",
            reason="restock",
            quantity=18,
            unit_cost_cents=1100,
            note="Opening count",
            created_by=ctx.owner_id,
            created_at=ctx.at(-180),
        ),
        Client(
            id="cl_archived",
            business_id=ctx.business_id,
            name="Sam Robertson",
            email="sam.retired@example.test",
            status="inactive",
            archived_at=ctx.at(-60),
            tags=["moved away"],
        ),
    )
    for index, (client_name, pet_name) in enumerate(
        (
            ("Elena Brooks", "Pip"),
            ("Ben Alvarez", "Olive"),
            ("Maya Ahmed", "Otis"),
            ("Ada Thompson", "Nori"),
        )
    ):
        client_id, pet_id = f"cl_class_{index}", f"sj_class_{index}"
        ctx.add(
            Client(
                id=client_id,
                business_id=ctx.business_id,
                name=client_name,
                email=f"puppy.family.{index}@example.test",
                status="active",
                tags=["puppy class"],
            ),
            Subject(
                id=pet_id,
                business_id=ctx.business_id,
                client_id=client_id,
                name=pet_name,
                kind="pet",
                attributes={
                    "species": "dog",
                    "breed": "Mixed breed",
                    "weight_kg": 5.5,
                    "birthday": ctx.at(-120).date().isoformat(),
                    "vaccinated": True,
                    "rabies_until": ctx.at(240).date().isoformat(),
                },
            ),
            Booking(
                id=f"bk_class_extra_{index}",
                business_id=ctx.business_id,
                slot_id="ses_class",
                staff_id="st_owner",
                client_id=client_id,
                subject_id=pet_id,
                status="waitlisted" if index == 3 else "confirmed",
                source="online",
                price_cents=3000,
                manage_token=f"demo_manage_class_{index}",
            ),
        )
