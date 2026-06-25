from clientbridge.models.crm import Client
from clientbridge.repositories.base import BaseRepository


class ClientRepository(BaseRepository[Client]):
    model = Client
    soft_delete = True
