"""One Cloud SQL for PostgreSQL 16 instance; the migrate step creates each database."""

from dataclasses import dataclass

import pulumi
import pulumi_gcp as gcp

from cloud import network
from environments import Environment

INSTANCE = "clientbridge"
TIER = "db-g1-small"
# every pod reaches the instance through its Auth Proxy sidecar on this address
PROXY_ADDRESS = "127.0.0.1:5432"
# both environments deploying at once, with room for Cloud SQL's own connections; the arithmetic
# is kubernetes/settings.py peak_connections and the plan's Database section
MAX_CONNECTIONS = 120
RESERVED_CONNECTIONS = 5
AUTH_MAX_CONNS = 5


@dataclass(frozen=True)
class Instance:
    sql: gcp.sql.DatabaseInstance


def create(region: str, zone: str, net: network.Network) -> Instance:
    sql = gcp.sql.DatabaseInstance(
        INSTANCE,
        name=INSTANCE,
        region=region,
        database_version="POSTGRES_16",
        deletion_protection=True,
        settings={
            "tier": TIER,
            "edition": "ENTERPRISE",
            "availability_type": "ZONAL",
            "location_preference": {"zone": zone},
            "disk_type": "PD_SSD",
            "disk_size": 10,
            "disk_autoresize": True,
            "deletion_protection_enabled": True,
            "ip_configuration": {
                "ipv4_enabled": False,
                "private_network": net.vpc.id,
                "ssl_mode": "ENCRYPTED_ONLY",
            },
            "backup_configuration": {
                "enabled": True,
                "start_time": "07:00",
                "point_in_time_recovery_enabled": True,
                "transaction_log_retention_days": 7,
                "backup_retention_settings": {"retained_backups": 7, "retention_unit": "COUNT"},
            },
            "maintenance_window": {"day": 7, "hour": 8, "update_track": "stable"},
            "insights_config": {"query_insights_enabled": True},
            "database_flags": [
                {"name": "cloudsql.logical_decoding", "value": "on"},
                {"name": "max_connections", "value": str(MAX_CONNECTIONS)},
            ],
        },
        opts=pulumi.ResourceOptions(protect=True, depends_on=[net.private_services]),
    )
    # no root password is set, so the built-in postgres user cannot log in; Cloud SQL requires a
    # password for every other user, so secrets_init.py creates each environment's admin
    return Instance(sql=sql)


def admin_user(env: Environment) -> str:
    # a CREATEROLE CREATEDB user; on PostgreSQL 16 it administers only the roles it creates, and
    # db_access.py creates the environment's databases with it, so Pulumi creates none
    return f"{env.name}_admin"


@dataclass(frozen=True)
class Login:
    """A database URL secrets_init.py writes; db_access.py applies its role's password."""

    user: str
    database: str
    scheme: str
    query: str = ""

    def url(self, password: str) -> str:
        return f"{self.scheme}://{self.user}:{password}@{PROXY_ADDRESS}/{self.database}{self.query}"


def logins(env: Environment) -> dict[str, Login]:
    """Each database URL secret of the environment, by its catalog name."""
    app, auth, storage = (
        f"{env.prefix}{name}" for name in ("clientbridge", "auth", "powersync_storage")
    )
    return {
        "ADMIN_DATABASE_URL": Login(admin_user(env), app, "postgresql+asyncpg"),
        "MIGRATION_DATABASE_URL": Login(
            f"{env.prefix}clientbridge_migrator", app, "postgresql+asyncpg"
        ),
        "DATABASE_URL": Login(f"{env.prefix}clientbridge_api", app, "postgresql+asyncpg"),
        "POWERSYNC_SOURCE_DATABASE_URL": Login(f"{env.prefix}powersync_source", app, "postgresql"),
        "POWERSYNC_STORAGE_DATABASE_URL": Login(
            f"{env.prefix}powersync_storage_owner", storage, "postgresql"
        ),
        # the Auth Proxy encrypts the connection, so the auth service talks plain TCP to localhost
        "AUTH_DATABASE_URL": Login(
            f"{env.prefix}auth",
            auth,
            "postgres",
            f"?sslmode=disable&max_conns={AUTH_MAX_CONNS}&max_idle_conns=2",
        ),
    }
