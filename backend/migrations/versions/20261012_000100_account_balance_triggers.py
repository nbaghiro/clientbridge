"""Keep accounts.balance_cents from the entries trigger alone, so no other write can move it."""

from collections.abc import Sequence

from alembic import op

revision: str = "cb0005"
down_revision: str | None = "cb0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION accounts_balance_from_entries() RETURNS trigger AS $$
        BEGIN
            PERFORM set_config('clientbridge.ledger_write', 'on', true);
            UPDATE accounts
            SET balance_cents = balance_cents + NEW.amount_cents, updated_at = now()
            WHERE id = NEW.account_id;
            PERFORM set_config('clientbridge.ledger_write', 'off', true);
            RETURN NULL;
        END $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER accounts_balance_from_entries AFTER INSERT ON entries "
        "FOR EACH ROW EXECUTE FUNCTION accounts_balance_from_entries()"
    )
    op.execute(
        """
        CREATE FUNCTION accounts_balance_guarded() RETURNS trigger AS $$
        BEGIN
            IF current_setting('clientbridge.ledger_write', true) IS DISTINCT FROM 'on'
               AND ((TG_OP = 'INSERT' AND NEW.balance_cents <> 0)
                    OR (TG_OP = 'UPDATE' AND NEW.balance_cents <> OLD.balance_cents)) THEN
                RAISE EXCEPTION 'account balances move only through ledger entries';
            END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER accounts_balance_guarded BEFORE INSERT OR UPDATE ON accounts "
        "FOR EACH ROW EXECUTE FUNCTION accounts_balance_guarded()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER accounts_balance_guarded ON accounts")
    op.execute("DROP FUNCTION accounts_balance_guarded()")
    op.execute("DROP TRIGGER accounts_balance_from_entries ON entries")
    op.execute("DROP FUNCTION accounts_balance_from_entries()")
