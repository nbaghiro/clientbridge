\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE powersync_storage'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'powersync_storage')
\gexec

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
        CREATE PUBLICATION powersync FOR ALL TABLES;
    END IF;
END
$$;
