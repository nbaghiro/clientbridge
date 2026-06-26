from clientbridge.models.catalog import Item
from clientbridge.repositories.base import BaseRepository


class ItemRepository(BaseRepository[Item]):
    model = Item
    soft_delete = False
