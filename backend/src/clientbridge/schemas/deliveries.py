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
    client_id: str | None = None
    opt_out: bool = Field(
        default=False, description="The client's email opt-out stops it, checked again as it goes"
    )


class SmsDelivery(BaseModel):
    channel: Literal["sms"] = "sms"
    message: Sms


class PushDelivery(BaseModel):
    channel: Literal["push"] = "push"
    message: Push


type DeliveryPayload = EmailDelivery | SmsDelivery | PushDelivery
DELIVERY_PAYLOAD: TypeAdapter[DeliveryPayload] = TypeAdapter(
    Annotated[DeliveryPayload, Field(discriminator="channel")]
)
