from typing import Annotated

from pydantic import BaseModel, StringConstraints


class ContactForm(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    email: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
        ),
    ]
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
