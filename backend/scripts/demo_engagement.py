import math
from datetime import datetime, timedelta
from pathlib import Path

from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Consent, Subject
from clientbridge.models.documents import (
    Contract,
    Form,
    FormField,
    FormResponse,
    SendOn,
    Signature,
)
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import File
from clientbridge.models.reviews import ReviewRequest
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.business import BrandInput
from clientbridge.services.consents import allows_marketing
from scripts.demo_context import BUSINESS_TIMEZONE, DemoContext, demo_business
from scripts.demo_documents import (
    CLASS_FIELDS,
    FEEDBACK_FIELDS,
    INTAKE_FIELDS,
    INTAKES,
    WAIVER_V1,
    WAIVER_V2,
    Field,
)

ASSETS = Path(__file__).parent / "demo_assets"


def _visits(ctx: DemoContext, client_id: str) -> list[tuple[Booking, Slot]]:
    slots = {slot.id: slot for slot in ctx.all(Slot)}
    return sorted(
        [(b, slots[b.slot_id]) for b in ctx.all(Booking) if b.client_id == client_id],
        key=lambda pair: pair[1].starts_at,
    )


def _intake_time(ctx: DemoContext, client_id: str) -> datetime:
    visits = _visits(ctx, client_id)
    first = visits[0][1].starts_at if visits else ctx.now
    return min(first - timedelta(days=2), ctx.now - timedelta(days=2))


def _thread(ctx: DemoContext, client_id: str, when: datetime) -> Thread:
    existing = next((t for t in ctx.all(Thread) if t.client_id == client_id), None)
    if existing is not None:
        existing.created_at = min(existing.created_at, when)
        existing.updated_at = max(existing.updated_at, when)
        return existing
    suffix = client_id.removeprefix("cl_")
    thread = Thread(
        id=f"th_{suffix}",
        business_id=ctx.business_id,
        client_id=client_id,
        status="open",
        created_at=when,
        updated_at=when,
    )
    ctx.add(thread)
    return thread


def _message(
    ctx: DemoContext,
    thread: Thread,
    body: str,
    when: datetime,
    *,
    direction: str = "out",
    status: str = "delivered",
    broadcast_id: str | None = None,
) -> None:
    index = len([m for m in ctx.all(Message) if m.thread_id == thread.id])
    ctx.add(
        Message(
            id=f"msg_{thread.id}_{index}",
            business_id=ctx.business_id,
            thread_id=thread.id,
            direction=direction,
            sent_by=ctx.owner_id if direction == "out" else None,
            body=body,
            status=status,
            broadcast_id=broadcast_id,
            provider_ref=None,
            created_at=when,
            updated_at=when,
        )
    )
    thread.created_at = min(thread.created_at, when)
    thread.updated_at = max(thread.updated_at, when)


def _consents(ctx: DemoContext) -> None:
    for client in ctx.all(Client):
        if client.status != "active" or client.deleted_at is not None or not client.phone:
            continue
        implied = client.id == "cl_sophie"
        when = ctx.now - timedelta(days=30 if implied else 90)
        when = max(when, client.created_at)
        ctx.add(
            Consent(
                id=f"cns_{client.id}",
                business_id=ctx.business_id,
                client_id=client.id,
                status="implied" if implied else "granted",
                source="online_booking" if implied else "in_person",
                recorded_by=ctx.owner_id,
                expires_at=ctx.now + timedelta(days=150) if implied else None,
                created_at=when,
                updated_at=when,
            )
        )
    when = ctx.now - timedelta(days=12)
    if any(c.id == "cl_noah" for c in ctx.all(Client)):
        ctx.add(
            Consent(
                id="cns_cl_noah_withdrawn",
                business_id=ctx.business_id,
                client_id="cl_noah",
                status="withdrawn",
                source="in_person",
                recorded_by=ctx.owner_id,
                created_at=when,
                updated_at=when,
            )
        )


def _conversations(ctx: DemoContext) -> None:
    for client_id in ("cl_amelie", "cl_marcus", "cl_david", "cl_sophie", "cl_olivia"):
        client = ctx.get(Client, client_id)
        visits = _visits(ctx, client_id)
        upcoming = [
            (b, s)
            for b, s in visits
            if s.starts_at > ctx.now and b.status in {"pending", "confirmed"}
        ]
        completed = [
            (b, s)
            for b, s in visits
            if b.status == "completed" and s.ends_at < ctx.now - timedelta(hours=1)
        ]
        when = ctx.now - timedelta(hours=4)
        thread = _thread(ctx, client_id, when)
        if upcoming:
            booking, slot = upcoming[0]
            pet = ctx.get(Subject, booking.subject_id) if booking.subject_id else None
            item = ctx.get(Item, slot.item_id)
            date = slot.starts_at.astimezone(BUSINESS_TIMEZONE).strftime("%A %B %d at %I:%M %p")
            body = (
                f"Hi {client.name.split()[0]}! {pet.name if pet else 'Your pet'} "
                f"is booked for {item.name} on {date} (Victoria time)."
            )
            _message(ctx, thread, body, when)
            _message(
                ctx,
                thread,
                "Thank you! Is there anything I should bring?",
                when + timedelta(minutes=14),
                direction="in",
                status="read",
            )
        elif completed:
            booking, slot = completed[-1]
            when = min(slot.ends_at + timedelta(minutes=20), ctx.now - timedelta(minutes=30))
            item = ctx.get(Item, slot.item_id)
            pet = ctx.get(Subject, booking.subject_id) if booking.subject_id else None
            _message(
                ctx,
                thread,
                f"{pet.name if pet else 'Your pet'} has finished {item.name}. "
                "Thank you for visiting Birchbark!",
                when,
            )
            _message(
                ctx,
                thread,
                "Thanks for the update and the careful service!",
                when + timedelta(minutes=10),
                direction="in",
                status="read",
            )
        else:
            _message(
                ctx,
                thread,
                "Happy to help plan your next visit. Let us know which service you need.",
                when,
            )
    # older than any device's synced history, so the inbox reads it back from the API
    welcomed = ctx.now - timedelta(days=400)
    thread = _thread(ctx, "cl_amelie", welcomed)
    _message(ctx, thread, "Welcome to Birchbark! Text us here any time about Bella.", welcomed)
    _message(
        ctx,
        thread,
        "Thank you, we're excited for her first groom!",
        welcomed + timedelta(minutes=9),
        direction="in",
        status="read",
    )
    thread = _thread(ctx, "cl_olivia", ctx.now - timedelta(hours=2))
    _message(
        ctx,
        thread,
        "Your booking enquiry reached us. Please reply with your preferred dates.",
        ctx.now - timedelta(hours=2),
        status="failed",
    )
    thread = _thread(ctx, "cl_sophie", ctx.now - timedelta(minutes=20))
    _message(
        ctx,
        thread,
        "Could you explain the check-in process for Mochi?",
        ctx.now - timedelta(minutes=20),
        direction="in",
        status="delivered",
    )


def _broadcasts(ctx: DemoContext) -> None:
    campaigns: list[tuple[str, str, dict[str, object], str, str, datetime]] = [
        (
            "bro_holiday",
            "Studio visit reminders",
            {"all": True},
            "sent",
            "Please bring your pet's vaccination details to your next visit. "
            "Reply if you need help updating an intake form.",
            ctx.now - timedelta(days=8),
        ),
        (
            "bro_deshed",
            "Seasonal coat care",
            {"tags": ["regular", "vip"]},
            "sent",
            "Brush regularly between grooms. Ask Birchbark which coat-care "
            "appointment suits your pet; no discount code is required.",
            ctx.now - timedelta(days=4),
        ),
        (
            "bro_winback",
            "A welcome back for Bandit",
            {"tags": ["churn-risk"]},
            "scheduled",
            "We would love to see you again. Reply when you are ready "
            "and we will help plan the right groom for your pet.",
            ctx.now + timedelta(days=1),
        ),
    ]
    for bid, name, audience, status, body, when in campaigns:
        tags = audience.get("tags")
        candidates = [
            c
            for c in ctx.all(Client)
            if c.status == "active"
            and c.deleted_at is None
            and (audience.get("all") or (isinstance(tags, list) and set(c.tags or []) & set(tags)))
        ]
        recipients: list[Client] = []
        for client in candidates:
            history = [
                c
                for c in ctx.all(Consent)
                if c.client_id == client.id and c.created_at <= min(when, ctx.now)
            ]
            consent = max(history, key=lambda c: (c.created_at, c.id), default=None)
            if client.phone and allows_marketing(consent, when):
                recipients.append(client)
        ctx.add(
            Broadcast(
                id=bid,
                business_id=ctx.business_id,
                created_by=ctx.owner_id,
                name=name,
                body=body,
                audience=audience,
                status=status,
                scheduled_at=when,
                recipient_count=len(recipients),
                excluded_count=len(candidates) - len(recipients),
                created_at=min(when - timedelta(days=1), ctx.now - timedelta(hours=1)),
                updated_at=min(when, ctx.now),
            )
        )
        if status == "sent":
            for index, client in enumerate(sorted(recipients, key=lambda c: c.id)):
                sent = when + timedelta(seconds=index)
                thread = _thread(ctx, client.id, sent)
                _message(
                    ctx,
                    thread,
                    body,
                    sent,
                    status="failed" if index == 1 and bid == "bro_deshed" else "delivered",
                    broadcast_id=bid,
                )


def _form(
    ctx: DemoContext,
    form_id: str,
    name: str,
    fields: tuple[Field, ...],
    when: datetime,
    *,
    signature: bool,
    send_on: SendOn = "manual",
) -> None:
    ctx.add(
        Form(
            id=form_id,
            business_id=ctx.business_id,
            name=name,
            require_signature=signature,
            active=True,
            send_on=send_on,
            created_at=when,
            updated_at=when,
        )
    )
    for position, (field, kind, label, hint, required, options) in enumerate(fields):
        ctx.add(
            FormField(
                id=f"ff_{form_id.removeprefix('frm_')}_{field}",
                business_id=ctx.business_id,
                form_id=form_id,
                name=field,
                input=kind,
                label=label,
                help=hint,
                required=required,
                options=list(options),
                position=position,
                created_at=when,
                updated_at=when,
            )
        )


def _attach(
    ctx: DemoContext, file_id: str, response_id: str, s3_key: str, kind: str, when: datetime
) -> str:
    asset = ASSETS / s3_key.rsplit("/", 1)[1]
    ctx.add(
        File(
            id=file_id,
            business_id=ctx.business_id,
            parent_type="form_response",
            parent_id=response_id,
            purpose="attachment",
            s3_key=s3_key,
            content_type=kind,
            size=asset.stat().st_size,
            created_at=when - timedelta(minutes=4),
            updated_at=when - timedelta(minutes=3),
        )
    )
    return file_id


def _strokes(seed: int) -> list[object]:
    """A short handwritten-looking signature, as the signing pad records it."""
    strokes: list[object] = []
    for part in range(3):
        left = 0.08 + part * 0.3
        strokes.append(
            [
                [
                    round(left + step * 0.012, 3),
                    round(0.5 + 0.22 * math.sin(step / (2.2 + seed % 3) + part), 3),
                ]
                for step in range(22)
            ]
        )
    return strokes


def _intakes(ctx: DemoContext, created: datetime) -> None:
    _form(
        ctx,
        "frm_intake",
        "New client and pet intake",
        INTAKE_FIELDS,
        created,
        signature=True,
        send_on="booking",
    )
    for index, (client_id, pet_id) in enumerate(
        (
            ("cl_amelie", "sj_bella"),
            ("cl_sophie", "sj_mochi"),
            ("cl_david", "sj_zeus"),
            ("cl_priscilla", "sj_kobe"),
        )
    ):
        client, pet = ctx.get(Client, client_id), ctx.get(Subject, pet_id)
        sex, health, medicine, handling, notes, style, groom, emergency = INTAKES[pet_id]
        when = _intake_time(ctx, client_id)
        response_id = f"fr_intake_{index}"
        photo = ctx.get(File, f"fl_{pet_id}")
        record = f"{ctx.business_id}/demo/vaccines-{pet.name.lower()}.pdf"
        answers: dict[str, object] = {
            "owner_name": client.name,
            "owner_phone": client.phone,
            "home_address": "1840 Oak Bay Avenue, Victoria, BC" if index % 2 == 0 else None,
            "pet_name": pet.name,
            "species": "Cat" if pet.attributes.get("species") == "cat" else "Dog",
            "breed": pet.attributes.get("breed"),
            "dob": pet.attributes.get("birthday"),
            "weight_kg": pet.attributes.get("weight_kg"),
            "sex": sex,
            "health": health,
            "medications": medicine,
            "vet_clinic": "Island Animal Clinic (demo)",
            "vet_phone": "+12505550199",
            "rabies_date": (when - timedelta(days=210)).date().isoformat(),
            "dhpp_date": (when - timedelta(days=210)).date().isoformat(),
            "bordetella_date": (when - timedelta(days=95)).date().isoformat(),
            "vax_record": _attach(
                ctx, f"fl_intake_record_{index}", response_id, record, "application/pdf", when
            ),
            "handling": handling,
            "handling_notes": notes,
            "groom_style": style,
            "groom_notes": groom,
            "emergency_name": emergency[0],
            "emergency_phone": emergency[1],
            "photo": _attach(
                ctx,
                f"fl_intake_photo_{index}",
                response_id,
                photo.s3_key,
                photo.content_type or "image/png",
                when,
            ),
            "consent_vet": True,
            "consent_matting": True,
            "consent_photos": index != 3,
        }
        ctx.add(
            FormResponse(
                id=response_id,
                business_id=ctx.business_id,
                form_id="frm_intake",
                client_id=client_id,
                parent_type="subject",
                parent_id=pet_id,
                status="submitted",
                token=f"demo_intake_{index}",
                created_at=when - timedelta(hours=1),
                opened_at=when - timedelta(minutes=30),
                submitted_at=when,
                updated_at=when,
                answers={k: v for k, v in answers.items() if v is not None},
                signature={
                    "name": client.name,
                    "strokes": _strokes(index) if index == 1 else None,
                    "ip": f"192.0.2.{20 + index}",
                },
            )
        )
    for index, client_id in enumerate(("cl_ethan", "cl_fatima")):
        when = ctx.now - timedelta(days=1)
        ctx.add(
            FormResponse(
                id=f"fr_intake_draft_{index}",
                business_id=ctx.business_id,
                form_id="frm_intake",
                client_id=client_id,
                parent_type="client",
                parent_id=client_id,
                status="draft",
                token=f"demo_intake_draft_{index}",
                answers={},
                created_at=when,
                updated_at=when,
                opened_at=when + timedelta(hours=1) if index == 0 else None,
            )
        )


# client, pet, class, age, how they are with dogs; the last one hasn't filled it in yet
ENROLMENTS = (
    ("cl_class_0", "sj_class_0", "Puppy Socialization (group)", "Under 6 months", "Plays well"),
    ("cl_class_1", "sj_class_1", "Puppy Socialization (group)", "Under 6 months", "Shy at first"),
    ("cl_class_2", "sj_class_2", "Puppy Socialization (group)", "Under 6 months", "Can be pushy"),
    (
        "cl_regular_05",
        "sj_regular_05",
        "Senior Dog Gentle Groom Workshop",
        "Over 7 years",
        "Shy at first",
    ),
    ("cl_regular_02", "sj_regular_02", "Small-Dog Play Group", "1 to 7 years", "Plays well"),
    ("cl_class_3", "sj_class_3", "Puppy Socialization (group)", "Under 6 months", ""),
)


def _enrolments(ctx: DemoContext, created: datetime) -> None:
    _form(
        ctx,
        "frm_class_enrolment",
        "Class enrolment and waiver",
        CLASS_FIELDS,
        created,
        signature=True,
    )
    clients = {c.id: c for c in ctx.all(Client)}
    pets = {p.id: p for p in ctx.all(Subject)}
    for index, (client_id, pet_id, title, age, manner) in enumerate(ENROLMENTS):
        client, pet = clients.get(client_id), pets.get(pet_id)
        if client is None or pet is None:
            continue
        when = _intake_time(ctx, client_id)
        response_id = f"fr_class_{index}"
        draft = manner == ""
        answers: dict[str, object] = {
            "class": title,
            "pet_name": pet.name,
            "age": age,
            "bordetella_date": (when - timedelta(days=20)).date().isoformat(),
            "around_dogs": manner,
            "handler_name": client.name,
            "handler_phone": client.phone,
            "ack_play": True,
            "ack_leash": True,
            "ack_cancel": True,
        }
        ctx.add(
            FormResponse(
                id=response_id,
                business_id=ctx.business_id,
                form_id="frm_class_enrolment",
                client_id=client_id,
                parent_type="subject",
                parent_id=pet_id,
                status="draft" if draft else "submitted",
                token=f"demo_class_{index}",
                created_at=when - timedelta(hours=3),
                opened_at=None if draft else when - timedelta(minutes=20),
                submitted_at=None if draft else when,
                updated_at=when - timedelta(hours=3) if draft else when,
                answers={} if draft else {k: v for k, v in answers.items() if v is not None},
                signature=None
                if draft
                else {
                    "name": client.name,
                    "strokes": _strokes(index) if index % 2 == 0 else None,
                    "ip": f"192.0.2.{40 + index}",
                },
            )
        )


# client, rating, what went well, comment, happy to be contacted
FEEDBACK = (
    (
        "cl_amelie",
        5,
        ["Gentle handling", "The finished groom"],
        "Thank you for taking the time to settle Bella.",
        False,
    ),
    (
        "cl_marcus",
        4,
        ["The finished groom", "Value"],
        "Rex looked great. The text saying he was ready came about 20 minutes after he was.",
        True,
    ),
)


def _feedback(ctx: DemoContext, created: datetime) -> None:
    _form(ctx, "frm_satisfaction", "Visit feedback", FEEDBACK_FIELDS, created, signature=False)
    for index, (client_id, rating, highlights, comment, follow_up) in enumerate(FEEDBACK):
        completed = [
            (b, slot)
            for b, slot in _visits(ctx, client_id)
            if b.status == "completed" and slot.ends_at < ctx.now - timedelta(days=2)
        ]
        if not completed:
            continue
        booking, slot = completed[-1]
        when = slot.ends_at + timedelta(hours=6)
        ctx.add(
            FormResponse(
                id=f"fr_satisfaction_{index}",
                business_id=ctx.business_id,
                form_id="frm_satisfaction",
                client_id=booking.client_id,
                parent_type="booking",
                parent_id=booking.id,
                status="submitted",
                token=f"demo_satisfaction_{index}",
                created_at=slot.ends_at,
                opened_at=when - timedelta(minutes=5),
                submitted_at=when,
                updated_at=when,
                answers={
                    "rating": rating,
                    "highlights": highlights,
                    "comments": comment,
                    "follow_up": follow_up,
                },
            )
        )


# client, pet, signs the version before the current one
SIGNERS = (
    ("cl_amelie", "sj_bella", True),
    ("cl_marcus", "sj_rex", True),
    ("cl_david", "sj_zeus", True),
    ("cl_sophie", "sj_mochi", False),
    ("cl_priscilla", "sj_kobe", False),
    ("cl_liam", "sj_maple", False),
)


def _waiver(ctx: DemoContext) -> datetime:
    """The agreement at its second version, with earlier clients' copies kept at the first."""
    published = min(
        _intake_time(ctx, client_id) for client_id, _, old in SIGNERS if not old
    ) - timedelta(days=1)
    signed = {
        client_id: min(_intake_time(ctx, client_id), published - timedelta(days=3))
        if old
        else _intake_time(ctx, client_id)
        for client_id, _, old in SIGNERS
    }
    created = min(signed.values()) - timedelta(days=2)
    contract = Contract(
        id="con_waiver",
        business_id=ctx.business_id,
        name="Grooming services agreement and waiver",
        version=2,
        active=True,
        body=WAIVER_V2,
        created_at=created,
        updated_at=published,
    )
    ctx.add(contract)
    for index, (client_id, pet_id, old) in enumerate(SIGNERS):
        client = ctx.get(Client, client_id)
        when = signed[client_id] + timedelta(hours=1)
        drawn = client_id == "cl_priscilla"
        ctx.add(
            Signature(
                id=f"sig_{index}",
                business_id=ctx.business_id,
                contract_id=contract.id,
                client_id=client_id,
                parent_type="subject",
                parent_id=pet_id,
                token=f"demo_signature_{index}",
                status="signed",
                signed_at=when,
                signed_body=WAIVER_V1 if old else WAIVER_V2,
                contract_version=1 if old else 2,
                signer_name=client.name,
                method="drawn" if drawn else "typed",
                strokes=_strokes(index) if drawn else None,
                ip=f"192.0.2.{index + 1}",
                created_at=when - timedelta(hours=1),
                opened_at=when - timedelta(minutes=15),
                updated_at=when,
            )
        )
    ctx.add(
        Signature(
            id="sig_pending",
            business_id=ctx.business_id,
            contract_id=contract.id,
            client_id="cl_fatima",
            parent_type="client",
            parent_id="cl_fatima",
            token="demo_signature_pending",
            status="pending",
            contract_version=2,
            created_at=ctx.now - timedelta(days=1),
            updated_at=ctx.now - timedelta(hours=3),
            opened_at=ctx.now - timedelta(hours=3),
        ),
        Signature(
            id="sig_declined",
            business_id=ctx.business_id,
            contract_id=contract.id,
            client_id="cl_olivia",
            parent_type="client",
            parent_id="cl_olivia",
            token="demo_signature_declined",
            status="declined",
            contract_version=2,
            created_at=ctx.now - timedelta(days=20),
            opened_at=ctx.now - timedelta(days=19, hours=20),
            updated_at=ctx.now - timedelta(days=19, hours=19),
        ),
    )
    artifact = ASSETS / "signed-waiver-amelie.txt"
    ctx.add(
        File(
            id="fl_signed_waiver_amelie",
            business_id=ctx.business_id,
            parent_type="signature",
            parent_id="sig_0",
            purpose="attachment",
            s3_key=f"{ctx.business_id}/demo/{artifact.name}",
            content_type="text/plain",
            size=artifact.stat().st_size,
            created_at=ctx.get(Signature, "sig_0").signed_at,
            updated_at=ctx.get(Signature, "sig_0").signed_at,
        )
    )
    return created


def _documents(ctx: DemoContext) -> None:
    created = _waiver(ctx)
    _intakes(ctx, created)
    _enrolments(ctx, created)
    _feedback(ctx, created)


def _reviews(ctx: DemoContext) -> None:
    clients = (
        "cl_amelie",
        "cl_marcus",
        "cl_liam",
        "cl_grace",
        "cl_sophie",
        "cl_david",
        "cl_yuki",
        "cl_noah",
    )
    for index, client_id in enumerate(clients):
        visits = [
            (b, s)
            for b, s in _visits(ctx, client_id)
            if b.status == "completed" and s.ends_at < ctx.now - timedelta(days=2)
        ]
        if not visits:
            continue
        booking, slot = visits[-1]
        when = max(slot.ends_at, booking.completed_at or slot.ends_at) + timedelta(hours=1)
        ctx.add(
            ReviewRequest(
                id=f"rrq_{index}",
                business_id=ctx.business_id,
                client_id=client_id,
                booking_id=booking.id,
                requested_at=when,
                created_at=when,
                updated_at=when,
            )
        )
    for index, client_id in enumerate(("cl_ethan", "cl_priscilla")):
        ctx.add(
            ReviewRequest(
                id=f"rrq_manual_{index}",
                business_id=ctx.business_id,
                client_id=client_id,
                requested_at=ctx.now - timedelta(days=1),
                created_at=ctx.now - timedelta(days=1),
                updated_at=ctx.now - timedelta(days=1),
            )
        )


def _profile(ctx: DemoContext) -> None:
    business = ctx.get(Business, ctx.business_id)
    brand = BrandInput.model_validate(
        {
            **business.brand,
            "about": (
                "A small, appointment-based pet studio in Victoria. Hannah, Diego and Priya "
                "offer patient grooming, coat care and supervised daycare, with time to "
                "discuss each pet's needs."
            ),
            "address": "1207 Government Street, Victoria, BC V8W 1Y9",
            "phone": "+1 250-555-0110",
            "email": "hello@birchbark.example",
            "website": demo_business(ctx.business_id).url,
            "neighbourhood": "Downtown Victoria",
            "gallery_urls": [],
            "cover_url": None,
            "public_staff_ids": [
                s.id for s in ctx.all(Staff) if s.status == "active" and s.bookable_online
            ],
        }
    )
    business.brand = brand.model_dump(exclude_none=True)


def build_engagement(ctx: DemoContext) -> None:
    _consents(ctx)
    _conversations(ctx)
    _broadcasts(ctx)
    _documents(ctx)
    _reviews(ctx)
    _profile(ctx)
