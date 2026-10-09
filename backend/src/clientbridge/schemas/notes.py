from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from clientbridge.core.mirrors import Mirror
from clientbridge.models.clients import Note, NoteParent


class NoteCreate(Mirror):
    mirrors = Note

    parent_type: Literal["client", "subject"]
    parent_id: str
    body: str = Field(min_length=1, max_length=4000)
    pinned: bool = False


class NoteUpdate(Mirror):
    mirrors = Note

    body: str | None = Field(default=None, min_length=1, max_length=4000)
    pinned: bool | None = None


class NoteOut(Mirror):
    mirrors = Note
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_id: str
    parent_type: NoteParent
    parent_id: str
    body: str
    pinned: bool
    created_by: str | None
    created_at: datetime
    updated_at: datetime
