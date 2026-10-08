from datetime import UTC, datetime, timedelta

import pytest
from scripts.demo_context import DemoContext
from scripts.demo_engagement import ASSETS, build_engagement

from clientbridge.models.business import Business, Staff
from clientbridge.models.catalog import Item
from clientbridge.models.clients import Client, Consent, Subject
from clientbridge.models.documents import Contract, FormField, FormResponse, Signature
from clientbridge.models.messaging import Broadcast, Message, Thread
from clientbridge.models.platform import File
from clientbridge.models.reviews import Review
from clientbridge.models.scheduling import Booking, Slot
from clientbridge.schemas.business import BrandInput
from clientbridge.services.consents import allows_marketing
from clientbridge.services.public import _validate


@pytest.fixture
def engagement() -> DemoContext:
    now = datetime(2026, 10, 8, 19, tzinfo=UTC)
    ctx = DemoContext(now, "bz_birchbark", "us_dev")
    ctx.add(Business(id=ctx.business_id, brand={"primary": "#2E4A3F"}))
    ctx.add(
        Staff(id="st_owner", business_id=ctx.business_id, status="active", bookable_online=True)
    )
    ctx.add(
        Staff(id="st_invited", business_id=ctx.business_id, status="invited", bookable_online=True)
    )
    ctx.add(Item(id="it_groom", business_id=ctx.business_id, name="Careful Groom"))
    people = (
        ("amelie", "Amélie Tremblay", "bella"),
        ("marcus", "Marcus Bennett", "rex"),
        ("sophie", "Sophie Nguyen", "mochi"),
        ("david", "David Okafor", "zeus"),
        ("priscilla", "Priscilla Chen", "kobe"),
        ("liam", "Liam O'Connor", "maple"),
        ("grace", "Grace Lin", "pepper"),
        ("yuki", "Yuki Tanaka", "miso"),
        ("noah", "Noah Williams", "simba"),
        ("ethan", "Ethan Brown", "cooper"),
        ("olivia", "Olivia Martin", "bandit"),
        ("fatima", "Fatima Ali", "willow"),
    )
    for index, (slug, name, pet) in enumerate(people):
        client_id, pet_id = f"cl_{slug}", f"sj_{pet}"
        ctx.add(
            Client(
                id=client_id,
                business_id=ctx.business_id,
                name=name,
                email=f"{slug}@example.com",
                phone=f"+1250555{index:04d}",
                status="active",
                tags=["churn-risk"] if slug == "olivia" else ["regular"],
                created_at=now - timedelta(days=200),
            )
        )
        ctx.add(
            Subject(
                id=pet_id,
                business_id=ctx.business_id,
                client_id=client_id,
                name=pet.title(),
                attributes={
                    "species": "cat" if pet == "miso" else "dog",
                    "breed": "Mixed",
                    "weight_kg": 10,
                },
            )
        )
        asset = ASSETS / f"pet_{pet}.png"
        ctx.add(
            File(
                id=f"fl_{pet_id}",
                business_id=ctx.business_id,
                parent_type="subject",
                parent_id=pet_id,
                purpose="photo",
                s3_key=f"{ctx.business_id}/demo/{asset.name}",
                content_type="image/png",
                size=asset.stat().st_size,
            )
        )
        if slug != "fatima":
            start = now - timedelta(days=10, hours=2)
            ctx.add(
                Slot(
                    id=f"slot_{slug}",
                    business_id=ctx.business_id,
                    item_id="it_groom",
                    starts_at=start,
                    ends_at=start + timedelta(hours=1),
                )
            )
            ctx.add(
                Booking(
                    id=f"bk_{slug}",
                    business_id=ctx.business_id,
                    client_id=client_id,
                    subject_id=pet_id,
                    slot_id=f"slot_{slug}",
                    status="completed",
                    completed_at=start + timedelta(hours=1),
                )
            )
    ctx.add(
        Slot(
            id="slot_future",
            business_id=ctx.business_id,
            item_id="it_groom",
            starts_at=now + timedelta(days=2),
            ends_at=now + timedelta(days=2, hours=1),
        )
    )
    ctx.add(
        Booking(
            id="bk_future",
            business_id=ctx.business_id,
            client_id="cl_sophie",
            subject_id="sj_mochi",
            slot_id="slot_future",
            status="confirmed",
        )
    )
    ctx.add(
        File(
            id="fl_gallery",
            business_id=ctx.business_id,
            parent_type="item",
            parent_id="it_groom",
            purpose="image",
            s3_key=f"{ctx.business_id}/demo/it_bath.png",
            content_type="image/png",
            size=(ASSETS / "it_bath.png").stat().st_size,
        )
    )
    build_engagement(ctx)
    return ctx


def test_submitted_intakes_pass_live_validator_and_have_owned_local_attachments(
    engagement: DemoContext,
) -> None:
    fields = [f for f in engagement.all(FormField) if f.form_id == "frm_intake"]
    for response in engagement.all(FormResponse):
        if response.status != "submitted" or response.form_id != "frm_intake":
            continue
        _validate(fields, response.answers)
        assert response.answers["vaccinated"] is True
        consent_id = response.answers["matting_consent"]
        assert isinstance(consent_id, str)
        consent_file = engagement.get(File, consent_id)
        assert (consent_file.parent_type, consent_file.parent_id) == ("form_response", response.id)
        assert consent_file.content_type == "application/pdf"
        consent_asset = ASSETS / consent_file.s3_key.rsplit("/", 1)[1]
        assert consent_asset.read_bytes().startswith(b"%PDF-")
        assert consent_asset.stat().st_size == consent_file.size
        assert response.opened_at is not None and response.submitted_at is not None
        assert response.created_at < response.opened_at < response.submitted_at <= engagement.now
        photo_id = response.answers["photo"]
        assert isinstance(photo_id, str)
        photo = engagement.get(File, photo_id)
        assert (photo.parent_type, photo.parent_id) == ("form_response", response.id)
        asset = ASSETS / photo.s3_key.rsplit("/", 1)[1]
        assert asset.stat().st_size == photo.size
    satisfaction = engagement.get(FormResponse, "fr_satisfaction_0")
    _validate(
        [f for f in engagement.all(FormField) if f.form_id == satisfaction.form_id],
        satisfaction.answers,
    )
    drafts = [r for r in engagement.all(FormResponse) if r.status == "draft"]
    assert len(drafts) == 2 and any(r.opened_at for r in drafts)
    assert all(r.token and r.submitted_at is None for r in drafts)


def test_signed_waivers_preserve_text_identity_version_and_real_artifact(
    engagement: DemoContext,
) -> None:
    contract = engagement.get(Contract, "con_waiver")
    signed = [s for s in engagement.all(Signature) if s.status == "signed"]
    assert len(signed) == 6
    for signature in signed:
        client = engagement.get(Client, signature.client_id)
        assert signature.signed_body == f"{contract.body}\n\n— Signed by {client.name}"
        assert signature.contract_version == contract.version
        assert signature.signer_name == client.name and signature.method == "typed"
        assert signature.opened_at is not None and signature.signed_at is not None
        assert signature.created_at <= signature.opened_at < signature.signed_at <= engagement.now
    artifact = engagement.get(File, "fl_signed_waiver_amelie")
    path = ASSETS / artifact.s3_key.rsplit("/", 1)[1]
    assert path.read_text() == engagement.get(Signature, artifact.parent_id).signed_body
    assert path.stat().st_size == artifact.size
    pending = engagement.get(Signature, "sig_pending")
    assert pending.token and pending.status == "pending" and pending.signed_at is None


def test_broadcasts_have_consent_backed_fanout_and_reconciled_counts(
    engagement: DemoContext,
) -> None:
    messages = engagement.all(Message)
    for campaign in engagement.all(Broadcast):
        assert campaign.body and campaign.recipient_count > 0
        fanout = [m for m in messages if m.broadcast_id == campaign.id]
        if campaign.status == "scheduled":
            assert campaign.scheduled_at is not None
            assert not fanout and campaign.scheduled_at > engagement.now
            continue
        assert len(fanout) == campaign.recipient_count
        recipients: set[str] = set()
        for message in fanout:
            client_id = engagement.get(Thread, message.thread_id).client_id
            recipients.add(client_id)
            consents = [
                c
                for c in engagement.all(Consent)
                if c.client_id == client_id
                and c.channel == campaign.channel
                and c.created_at <= message.created_at
            ]
            latest = max(consents, key=lambda c: (c.created_at, c.id))
            assert allows_marketing(latest, message.created_at)
            assert message.body == campaign.body and message.created_at <= engagement.now
        assert len(recipients) == len(fanout)
        assert (
            "cl_noah" not in recipients
            if campaign.channel == "sms"
            else "cl_fatima" not in recipients
        )
    assert {c.status for c in engagement.all(Consent)} == {"granted", "implied", "withdrawn"}


def test_conversations_have_distinct_times_channel_identity_and_inbox_states(
    engagement: DemoContext,
) -> None:
    threads, messages = engagement.all(Thread), engagement.all(Message)
    assert len({t.id for t in threads}) == len(threads)
    assert len({(t.client_id, t.channel) for t in threads}) == len(threads)
    assert any(t.status == "closed" for t in threads)
    assert any(m.direction == "in" and m.status != "read" for m in messages)
    assert any(m.status == "failed" for m in messages)
    assert len({m.created_at for m in messages}) > 5
    for message in messages:
        thread = engagement.get(Thread, message.thread_id)
        assert message.channel == thread.channel
        assert thread.created_at <= message.created_at <= thread.updated_at <= engagement.now
        assert (message.sent_by is None) == (message.direction == "in")
        assert message.provider_ref is None
    reminder = next(m for m in messages if "Victoria time" in (m.body or ""))
    assert "Saturday October 10" in (reminder.body or "")


def test_reviews_follow_completed_visits_and_hold_low_feedback(engagement: DemoContext) -> None:
    reviews = [r for r in engagement.all(Review) if r.booking_id]
    assert len({r.booking_id for r in reviews}) == len(reviews) == 8
    for review in reviews:
        booking = engagement.get(Booking, review.booking_id or "")
        slot = engagement.get(Slot, booking.slot_id)
        assert review.client_id == booking.client_id and booking.status == "completed"
        assert review.requested_at is not None and review.submitted_at is not None
        assert slot.ends_at < review.requested_at < review.submitted_at <= engagement.now
        if review.responded_at:
            assert review.submitted_at < review.responded_at <= engagement.now
        assert "Careful Groom" in (review.body or "")
    held = engagement.get(Review, "rv_7")
    assert held.rating == 2 and held.status == "submitted" and not held.sent_to_google
    assert "parking" in (engagement.get(Review, "rv_3").response or "")
    assert "Miso" in (engagement.get(Review, "rv_6").response or "")


def test_public_profile_uses_brand_contract_and_only_active_team(engagement: DemoContext) -> None:
    brand = engagement.get(Business, engagement.business_id).brand
    assert set(brand) <= BrandInput.model_fields.keys()
    profile = BrandInput.model_validate(brand)
    assert profile.about and profile.address and profile.phone and profile.email
    assert profile.public_staff_ids == ["st_owner"]
    assert profile.gallery_urls and all("/media/" in url for url in profile.gallery_urls)
