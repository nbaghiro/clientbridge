from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from clientbridge.integrations.expo import Push
from clientbridge.integrations.resend import Email
from clientbridge.integrations.twilio import Sms


class EmailDelivery(BaseModel):
    model_config = ConfigDict(ser_json_bytes="base64", val_json_bytes="base64")
    channel: Literal["email"] = "email"
    message: Email
    transport: Literal["smtp", "resend"] | None = None


class SmsDelivery(BaseModel):
    channel: Literal["sms"] = "sms"
    message: Sms
    message_id: str | None = Field(
        default=None, description="The inbox message this sends; its status follows the outcome"
    )


class PushDelivery(BaseModel):
    channel: Literal["push"] = "push"
    message: Push


type DeliveryPayload = EmailDelivery | SmsDelivery | PushDelivery
DELIVERY_PAYLOAD: TypeAdapter[DeliveryPayload] = TypeAdapter(
    Annotated[DeliveryPayload, Field(discriminator="channel")]
)


class EmailBounce(BaseModel):
    type: str = ""
    sub_type: str = Field(default="", alias="subType")
    message: str = ""


class EmailFailure(BaseModel):
    reason: str = ""


class EmailEventData(BaseModel):
    email_id: str | None = None
    to: list[str] | str | None = None
    tags: dict[str, str] | None = None
    bounce: EmailBounce | None = None
    failed: EmailFailure | None = None


class EmailEventBody(BaseModel):
    """A Resend event, validated only after its Svix signature is checked."""

    type: str
    created_at: datetime | None = None
    data: EmailEventData | None = None
