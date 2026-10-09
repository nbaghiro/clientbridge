from datetime import datetime, timedelta
from pathlib import Path

from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Consent, Subject
from clientbridge.models.documents import Contract, Form, FormField, FormResponse, Signature
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import File
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.business import BrandInput
from clientbridge.services.consents import allows_marketing
from scripts.demo_context import BUSINESS_TIMEZONE, DemoContext

ASSETS = Path(__file__).parent / "demo_assets"
WAIVER_BODY = (
    "I authorize Birchbark Pet Studio to groom my pet. I understand that severely "
    "matted coats may require a humane shave-down, and that grooming can occasionally "
    "expose pre-existing skin or health conditions. In an emergency I authorize "
    "Birchbark to seek veterinary care at my expense. Cancellations within 24 hours "
    "may incur a 50% fee."
)
INTAKE_FIELDS = (
    ("pet_name", "text", "Pet's name", True),
    ("species", "select", "Species", True),
    ("breed", "text", "Breed", False),
    ("dob", "date", "Date of birth", False),
    ("weight_kg", "number", "Weight (kg)", False),
    ("vaccinated", "checkbox", "Vaccinations up to date?", True),
    ("allergies", "longtext", "Allergies or skin conditions", False),
    ("behaviour", "multiselect", "Behaviour notes", False),
    ("vet_name", "text", "Veterinarian", False),
    ("emergency_phone", "phone", "Emergency contact", True),
    ("owner_email", "email", "Your email", True),
    ("home_address", "address", "Home address", False),
    ("preferred_time", "time", "Preferred drop-off time", False),
    ("grooming_budget", "currency", "Typical grooming budget", False),
    ("vax_record", "file", "Vaccination record (PDF)", False),
    ("photo", "image", "A recent photo", False),
    ("matting_consent", "signature", "I consent to humane de-matting if required", True),
)


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


def _thread(ctx: DemoContext, client_id: str, channel: str, when: datetime) -> Thread:
    existing = next(
        (t for t in ctx.all(Thread) if (t.client_id, t.channel) == (client_id, channel)), None
    )
    if existing is not None:
        existing.created_at = min(existing.created_at, when)
        existing.updated_at = max(existing.updated_at, when)
        return existing
    suffix = client_id.removeprefix("cl_")
    stable = (channel == "sms" and client_id != "cl_sophie") or (
        channel == "email" and client_id == "cl_sophie"
    )
    tid = f"th_{suffix}" if stable else f"th_{suffix}_{channel}"
    thread = Thread(
        id=tid,
        business_id=ctx.business_id,
        client_id=client_id,
        channel=channel,
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
            channel=thread.channel,
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
        if client.status != "active" or client.deleted_at is not None:
            continue
        for channel in ("email", "sms"):
            if not (client.email if channel == "email" else client.phone):
                continue
            implied = client.id == "cl_sophie"
            when = ctx.now - timedelta(days=30 if implied else 90)
            if client.created_at is not None:
                when = max(when, client.created_at)
            ctx.add(
                Consent(
                    id=f"cns_{client.id}_{channel}",
                    business_id=ctx.business_id,
                    client_id=client.id,
                    channel=channel,
                    status="implied" if implied else "granted",
                    source="online_booking" if implied else "in_person",
                    recorded_by=ctx.owner_id,
                    expires_at=ctx.now + timedelta(days=150) if implied else None,
                    created_at=when,
                    updated_at=when,
                )
            )
    for client_id, channel in (("cl_noah", "sms"), ("cl_fatima", "email")):
        when = ctx.now - timedelta(days=12)
        if any(c.id == client_id for c in ctx.all(Client)):
            ctx.add(
                Consent(
                    id=f"cns_{client_id}_{channel}_withdrawn",
                    business_id=ctx.business_id,
                    client_id=client_id,
                    channel=channel,
                    status="withdrawn",
                    source="preferences",
                    recorded_by=None,
                    created_at=when,
                    updated_at=when,
                )
            )


def _conversations(ctx: DemoContext) -> None:
    for client_id in ("cl_amelie", "cl_marcus", "cl_david", "cl_sophie", "cl_olivia"):
        client = ctx.get(Client, client_id)
        channel = "email" if client_id == "cl_sophie" else "sms"
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
        thread = _thread(ctx, client_id, channel, when)
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
                status="delivered" if client_id == "cl_sophie" else "read",
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
        if client_id == "cl_marcus":
            thread.status = "closed"
    thread = _thread(ctx, "cl_olivia", "sms", ctx.now - timedelta(hours=2))
    _message(
        ctx,
        thread,
        "Your booking enquiry reached us. Please reply with your preferred dates.",
        ctx.now - timedelta(hours=2),
        status="failed",
    )
    thread = _thread(ctx, "cl_sophie", "email", ctx.now - timedelta(minutes=20))
    _message(
        ctx,
        thread,
        "Could you explain the check-in process for Mochi?",
        ctx.now - timedelta(minutes=20),
        direction="in",
        status="delivered",
    )


def _broadcasts(ctx: DemoContext) -> None:
    campaigns: list[tuple[str, str, str, dict[str, object], str, str, datetime]] = [
        (
            "bro_holiday",
            "Studio visit reminders",
            "email",
            {"all": True},
            "sent",
            "Please bring your pet's vaccination details to your next visit. "
            "Reply if you need help updating an intake form.",
            ctx.now - timedelta(days=8),
        ),
        (
            "bro_deshed",
            "Seasonal coat care",
            "sms",
            {"tags": ["regular", "vip"]},
            "sent",
            "Brush regularly between grooms. Ask Birchbark which coat-care "
            "appointment suits your pet; no discount code is required.",
            ctx.now - timedelta(days=4),
        ),
        (
            "bro_winback",
            "A welcome back for Bandit",
            "sms",
            {"tags": ["churn-risk"]},
            "scheduled",
            "We would love to see you again. Reply when you are ready "
            "and we will help plan the right groom for your pet.",
            ctx.now + timedelta(days=1),
        ),
    ]
    for bid, name, channel, audience, status, body, when in campaigns:
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
                if c.client_id == client.id
                and c.channel == channel
                and c.created_at <= min(when, ctx.now)
            ]
            consent = max(history, key=lambda c: (c.created_at, c.id), default=None)
            if (client.phone if channel == "sms" else client.email) and allows_marketing(
                consent, when
            ):
                recipients.append(client)
        ctx.add(
            Broadcast(
                id=bid,
                business_id=ctx.business_id,
                created_by=ctx.owner_id,
                name=name,
                channel=channel,
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
                thread = _thread(ctx, client.id, channel, sent)
                _message(
                    ctx,
                    thread,
                    body,
                    sent,
                    status="failed" if index == 1 and bid == "bro_deshed" else "delivered",
                    broadcast_id=bid,
                )


def _documents(ctx: DemoContext) -> None:
    created = min((_intake_time(ctx, c.id) for c in ctx.all(Client)), default=ctx.now) - timedelta(
        days=1
    )
    ctx.add(
        Form(
            id="frm_intake",
            business_id=ctx.business_id,
            name="New Pet Intake",
            require_signature=True,
            active=True,
            send_on="manual",
            created_at=created,
            updated_at=created,
        )
    )
    for position, (name, kind, label, required) in enumerate(INTAKE_FIELDS):
        options: list[object] = (
            ["Dog", "Cat", "Other"]
            if kind == "select"
            else ["Anxious", "Reactive to dryers", "Dislikes nails", "Food motivated", "Friendly"]
            if kind == "multiselect"
            else []
        )
        ctx.add(
            FormField(
                id=f"ff_{name}",
                business_id=ctx.business_id,
                form_id="frm_intake",
                name=name,
                input=kind,
                label=label,
                required=required,
                options=options,
                validation={},
                position=position,
                created_at=created,
                updated_at=created,
            )
        )
    ctx.add(
        Form(
            id="frm_satisfaction",
            business_id=ctx.business_id,
            name="Grooming Satisfaction",
            require_signature=False,
            active=True,
            send_on="manual",
            created_at=created,
            updated_at=created,
        )
    )
    for position, (name, kind, label) in enumerate(
        (
            ("rating", "rating", "How did we do?"),
            ("comments", "longtext", "Anything we could do better?"),
        )
    ):
        ctx.add(
            FormField(
                id=f"ff_{name}",
                business_id=ctx.business_id,
                form_id="frm_satisfaction",
                name=name,
                input=kind,
                label=label,
                required=name == "rating",
                options=[],
                validation={},
                position=position,
                created_at=created,
                updated_at=created,
            )
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
        when = _intake_time(ctx, client_id)
        response_id = f"fr_intake_{index}"
        photo = ctx.get(File, f"fl_{pet_id}")
        file_id = f"fl_intake_photo_{index}"
        ctx.add(
            File(
                id=file_id,
                business_id=ctx.business_id,
                parent_type="form_response",
                parent_id=response_id,
                purpose="attachment",
                s3_key=photo.s3_key,
                content_type=photo.content_type,
                size=photo.size,
                created_at=when,
                updated_at=when,
            )
        )
        consent_asset = ASSETS / f"consent-{client_id.removeprefix('cl_')}.pdf"
        consent_id = f"fl_intake_consent_{index}"
        ctx.add(
            File(
                id=consent_id,
                business_id=ctx.business_id,
                parent_type="form_response",
                parent_id=response_id,
                purpose="attachment",
                s3_key=f"{ctx.business_id}/demo/{consent_asset.name}",
                content_type="application/pdf",
                size=consent_asset.stat().st_size,
                created_at=when,
                updated_at=when,
            )
        )
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
                answers={
                    "pet_name": pet.name,
                    "species": "Cat" if pet.attributes.get("species") == "cat" else "Dog",
                    "breed": pet.attributes.get("breed", "Mixed"),
                    "weight_kg": pet.attributes.get("weight_kg", 10),
                    "vaccinated": True,
                    "emergency_phone": client.phone or "+12505550100",
                    "owner_email": client.email or "demo@example.com",
                    "behaviour": ["Anxious"]
                    if pet.attributes.get("temperament") == "anxious"
                    else ["Friendly"],
                    "matting_consent": consent_id,
                    "photo": file_id,
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
    completed = [
        (b, slot)
        for b, slot in _visits(ctx, "cl_amelie")
        if b.status == "completed" and slot.ends_at < ctx.now - timedelta(days=2)
    ]
    if completed:
        booking, slot = completed[-1]
        when = slot.ends_at + timedelta(hours=6)
        ctx.add(
            FormResponse(
                id="fr_satisfaction_0",
                business_id=ctx.business_id,
                form_id="frm_satisfaction",
                client_id=booking.client_id,
                parent_type="booking",
                parent_id=booking.id,
                status="submitted",
                token="demo_satisfaction_0",
                created_at=slot.ends_at,
                opened_at=when - timedelta(minutes=5),
                submitted_at=when,
                updated_at=when,
                answers={"rating": 5, "comments": "Thank you for taking the time to settle Bella."},
            )
        )
    contract = Contract(
        id="con_waiver",
        business_id=ctx.business_id,
        name="Grooming Services Agreement & Waiver",
        version=2,
        active=True,
        body=WAIVER_BODY,
        created_at=created,
        updated_at=created,
    )
    ctx.add(contract)
    for index, (client_id, pet_id) in enumerate(
        (
            ("cl_amelie", "sj_bella"),
            ("cl_marcus", "sj_rex"),
            ("cl_david", "sj_zeus"),
            ("cl_sophie", "sj_mochi"),
            ("cl_priscilla", "sj_kobe"),
            ("cl_liam", "sj_maple"),
        )
    ):
        client = ctx.get(Client, client_id)
        when = _intake_time(ctx, client_id) + timedelta(hours=1)
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
                signed_body=f"{contract.body}\n\n— Signed by {client.name}",
                contract_version=contract.version,
                signer_name=client.name,
                method="typed",
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
            created_at=ctx.now - timedelta(days=1),
            updated_at=ctx.now - timedelta(hours=3),
            opened_at=ctx.now - timedelta(hours=3),
        )
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
        pet = ctx.get(Subject, booking.subject_id) if booking.subject_id else None
        item = ctx.get(Item, slot.item_id)
        rating = 2 if client_id == "cl_noah" else 4 if client_id in {"cl_grace", "cl_yuki"} else 5
        body = (
            f"Thank you for {item.name} for {pet.name if pet else 'our pet'}. "
            "The team was careful and welcoming."
        )
        response = None
        if client_id == "cl_grace":
            body += " Finding parking took a little longer than expected."
            response = (
                "Thank you, Grace. We can explain the nearby parking options "
                "before Pepper's next appointment."
            )
        if client_id == "cl_yuki":
            response = (
                "Thank you, Yuki. We are glad the calm handling helped Miso feel more comfortable."
            )
        if client_id == "cl_noah":
            body = (
                f"{item.name} was completed carefully, but check-in took longer than I expected. "
                "Please explain the arrival process."
            )
        when = max(slot.ends_at, booking.completed_at or slot.ends_at) + timedelta(hours=1)
        ctx.add(
            Review(
                id=f"rv_{index}",
                business_id=ctx.business_id,
                client_id=client_id,
                booking_id=booking.id,
                channel="sms",
                token=f"rev_tok_{index}",
                status="submitted" if rating <= 2 else "published",
                requested_at=when,
                submitted_at=when + timedelta(hours=2),
                rating=rating,
                body=body,
                response=response,
                responded_at=when + timedelta(hours=5) if response else None,
                sent_to_google=False,
                created_at=when,
                updated_at=when + timedelta(hours=5 if response else 2),
            )
        )
    for index, client_id in enumerate(("cl_ethan", "cl_priscilla")):
        ctx.add(
            Review(
                id=f"rv_p_{index}",
                business_id=ctx.business_id,
                client_id=client_id,
                channel="email",
                token=f"rev_tok_p_{index}",
                status="requested" if index == 0 else "opened",
                requested_at=ctx.now - timedelta(days=1),
                sent_to_google=False,
                created_at=ctx.now - timedelta(days=1),
                updated_at=ctx.now - timedelta(hours=4),
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
            "address": "1207 Government Street, Victoria, BC (fictional demo location)",
            "phone": "+1 250-555-0110",
            "email": "hello@birchbark.example",
            "neighbourhood": "Downtown Victoria",
            "gallery_urls": [],
            "cover_url": None,
            "public_staff_ids": [
                s.id for s in ctx.all(Staff) if s.status == "active" and s.bookable_online
            ],
        }
    )
    business.brand = brand.model_dump(exclude_none=True)
    business.review_hold_at = 3


def build_engagement(ctx: DemoContext) -> None:
    _consents(ctx)
    _conversations(ctx)
    _broadcasts(ctx)
    _documents(ctx)
    _reviews(ctx)
    _profile(ctx)
