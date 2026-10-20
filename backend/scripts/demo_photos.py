"""Portraits for the demo's team members and for clients with no negative storyline."""

from hashlib import sha256
from pathlib import Path

from clientbridge.models.platform import File, FileParent
from scripts.demo_context import DemoContext

ASSETS = Path(__file__).parent / "demo_assets"

TEAMS: dict[str, tuple[str, ...]] = {
    "bz_birchbark": ("us_dev", "us_admin", "us_diego", "us_priya"),
    "bz_demo_second": ("us_second_owner",),
    "bz_northlight": ("us_nl_owner", "us_nl_office", "us_nl_liam", "us_nl_ava"),
}

# about a third of each book, all clients without a negative storyline (demo_validate checks)
CLIENTS: dict[str, tuple[str, ...]] = {
    "bz_birchbark": (
        "cl_priscilla",
        "cl_fatima",
        "cl_nadia",
        "cl_tom",
        "cl_class_2",
        "cl_regular_01",
        "cl_regular_03",
        "cl_regular_05",
        "cl_regular_07",
        "cl_regular_08",
        "cl_regular_13",
        "cl_regular_15",
        "cl_regular_16",
        "cl_regular_19",
        "cl_regular_22",
        "cl_regular_24",
        "cl_regular_29",
        "cl_regular_31",
        "cl_regular_33",
        "cl_regular_36",
        "cl_regular_38",
        "cl_regular_41",
        "cl_regular_44",
        "cl_regular_46",
        "cl_regular_49",
        "cl_regular_52",
        "cl_regular_55",
        "cl_regular_57",
        "cl_regular_60",
        "cl_regular_62",
        "cl_regular_65",
        "cl_regular_69",
        "cl_regular_73",
    ),
    "bz_demo_second": ("cl_second_private",),
    "bz_northlight": (
        "cl_nl_aisha",
        "cl_nl_arjun",
        "cl_nl_claire",
        "cl_nl_diane",
        "cl_nl_hana",
        "cl_nl_harper",
        "cl_nl_jasmine",
        "cl_nl_joan",
        "cl_nl_louise",
        "cl_nl_meilin",
        "cl_nl_owen",
        "cl_nl_rajesh",
        "cl_nl_ruth",
        "cl_nl_sarah",
        "cl_nl_simon",
        *(f"cl_nl_home_{n:02}" for n in range(10)),
    ),
}


def add_people_photos(ctx: DemoContext, business_id: str) -> None:
    people: list[tuple[FileParent, str]] = [
        *(("user", user_id) for user_id in TEAMS[business_id]),
        *(("client", client_id) for client_id in CLIENTS[business_id]),
    ]
    for parent_type, parent_id in people:
        path = ASSETS / f"face_{parent_id}.jpg"
        digest = sha256(path.read_bytes()).hexdigest()[:12]
        ctx.add(
            File(
                id=f"fl_face_{parent_id}_{digest}",
                business_id=business_id,
                parent_type=parent_type,
                parent_id=parent_id,
                purpose="photo",
                s3_key=f"{business_id}/demo/{digest}/{path.name}",
                content_type="image/jpeg",
                size=path.stat().st_size,
                created_at=ctx.now,
                updated_at=ctx.now,
                uploaded_at=ctx.now,
            )
        )
