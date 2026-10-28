from pydantic import BaseModel, Field


class OutgoingText(BaseModel):
    to: str
    body: str


class OutgoingPreview(BaseModel):
    """What a send would deliver, word for word, without sending it."""

    recipient: str | None = Field(description="The client's name, when it goes to a client")
    text: OutgoingText | None
