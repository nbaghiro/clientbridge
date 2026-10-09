import types
from collections.abc import Iterable
from typing import Annotated, ClassVar, Literal, Union, get_args, get_origin, get_type_hints

from pydantic import BaseModel
from sqlalchemy import inspect

from clientbridge.core.db import Base

_NONE = type(None)
_JSON_OBJECT = (dict, (frozenset({str}), frozenset({object})))


class Mirror(BaseModel):
    """An API shape whose fields named after a column carry that column's type or a narrower one."""

    mirrors: ClassVar[type[Base]]
    derived: ClassVar[frozenset[str]] = frozenset()


def _atoms(tp: object) -> frozenset[object]:
    origin = get_origin(tp)
    if origin is Annotated:
        return _atoms(get_args(tp)[0])
    if origin in (Union, types.UnionType):
        return frozenset(atom for arg in get_args(tp) for atom in _atoms(arg))
    if origin is Literal:
        return frozenset(get_args(tp))
    if origin is None:
        return frozenset({tp})
    return frozenset({(origin, tuple(_atoms(arg) for arg in get_args(tp)))})


def _atom_fits(atom: object, allowed: object) -> bool:
    if atom == allowed or allowed is object:
        return True
    if isinstance(atom, str | int) and isinstance(allowed, type):
        return isinstance(atom, allowed)
    if isinstance(atom, type) and issubclass(atom, BaseModel):
        return allowed == _JSON_OBJECT
    if isinstance(atom, tuple) and isinstance(allowed, tuple):
        (origin, args), (allowed_origin, allowed_args) = atom, allowed
        return (
            origin is allowed_origin
            and len(args) == len(allowed_args)
            and all(_fits(arg, other) for arg, other in zip(args, allowed_args, strict=True))
        )
    return False


def _fits(atoms: frozenset[object], allowed: frozenset[object]) -> bool:
    return all(
        any(_atom_fits(atom, other) for other in allowed) for atom in atoms if atom is not _NONE
    )


def _column_types(model: type[Base]) -> dict[str, frozenset[object]]:
    hints = get_type_hints(model)
    return {attr.key: _atoms(get_args(hints[attr.key])[0]) for attr in inspect(model).column_attrs}


def mirrored() -> list[type[Mirror]]:
    found: set[type[Mirror]] = set()
    pending = Mirror.__subclasses__()
    while pending:
        schema = pending.pop()
        found.add(schema)
        pending.extend(schema.__subclasses__())
    return sorted(found, key=lambda schema: schema.__qualname__)


def mirror_errors(schemas: Iterable[type[Mirror]]) -> tuple[str, ...]:
    errors: list[str] = []
    for schema in schemas:
        columns = _column_types(schema.mirrors)
        for name in sorted(schema.derived - (columns.keys() & schema.model_fields.keys())):
            errors.append(f"{schema.__name__}.{name}: derived but not a field named after a column")
        for name, field in schema.model_fields.items():
            if name in schema.derived or name not in columns:
                continue
            if not _fits(_atoms(field.annotation), columns[name]):
                errors.append(
                    f"{schema.__name__}.{name}: {field.annotation} is wider than "
                    f"{schema.mirrors.__name__}.{name}"
                )
    return tuple(errors)
