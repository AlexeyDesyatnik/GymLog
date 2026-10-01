import pg from "pg";

/**
 * The role the app connects to PostgreSQL as (#39). It owns GymLog's database, so it applies the
 * migrations, but it isn't a superuser: it can't run programs or read files on the database
 * server, as `COPY ... PROGRAM` lets a superuser do.
 */
export const APP_ROLE = "gymlog_app";

/** Creates the app's role, or brings it back to these rights and this password. Connects as a superuser. */
export async function ensureAppRole(superuserUrl: string, password: string): Promise<void> {
  await withClient(superuserUrl, async (client) => {
    const { rowCount } = await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
    // A password can't be a query parameter here, so it is quoted into the statement.
    await client.query(
      `${rowCount ? "ALTER" : "CREATE"} ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
        `NOREPLICATION NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
    );
    await client.query(
      `REVOKE pg_execute_server_program, pg_read_server_files, pg_write_server_files FROM ${APP_ROLE}`,
    );
  });
}

/**
 * Gives the database this URL connects to, with everything already in it, to the app's role.
 * Connects as a superuser, after ensureAppRole; safe to run again.
 */
export async function handDatabaseToApp(superuserUrl: string): Promise<void> {
  await withClient(superuserUrl, async (client) => {
    // One statement, so all of it happens or none. The superuser the postgres image creates owns
    // the system catalogs too, so REASSIGN OWNED can't be used: each of GymLog's own schemas,
    // tables and sequences is given away instead.
    await client.query(`DO $$
      DECLARE
        me oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
        object record;
      BEGIN
        EXECUTE format('ALTER DATABASE %I OWNER TO ${APP_ROLE}', current_database());
        FOR object IN SELECT nspname FROM pg_namespace
          WHERE nspowner = me AND nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
        LOOP
          EXECUTE format('ALTER SCHEMA %I OWNER TO ${APP_ROLE}', object.nspname);
        END LOOP;
        -- Tables first: a table takes the sequences of its own columns along.
        FOR object IN SELECT c.oid::regclass AS name, c.relkind FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relowner = me AND c.relkind IN ('r', 'p', 'S')
            AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
          ORDER BY c.relkind = 'S'
        LOOP
          CONTINUE WHEN object.relkind = 'S'
            AND (SELECT relowner FROM pg_class WHERE oid = object.name) <> me;
          EXECUTE format('ALTER %s %s OWNER TO ${APP_ROLE}',
            CASE object.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, object.name);
        END LOOP;
        IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relowner = me AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema')
        THEN
          RAISE EXCEPTION 'Something in the database is still owned by %, which only the app''s role should own', current_user;
        END IF;
      END $$`);
  });
}

async function withClient(url: string, use: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await use(client);
  } finally {
    await client.end();
  }
}
