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
    // tables, sequences, views, types and functions is given away instead.
    await client.query(`DO $$
      DECLARE
        me oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
        -- GymLog's own schemas, not PostgreSQL's.
        schemas oid[] := ARRAY(SELECT oid FROM pg_namespace
          WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema');
        object record;
      BEGIN
        EXECUTE format('ALTER DATABASE %I OWNER TO ${APP_ROLE}', current_database());
        FOR object IN SELECT nspname FROM pg_namespace WHERE nspowner = me AND oid = ANY (schemas) LOOP
          EXECUTE format('ALTER SCHEMA %I OWNER TO ${APP_ROLE}', object.nspname);
        END LOOP;
        -- Tables first: a table takes its indexes and the sequences of its own columns along, so
        -- each is looked at again when its turn comes.
        FOR object IN SELECT oid, oid::regclass AS name, relkind FROM pg_class
          WHERE relowner = me AND relnamespace = ANY (schemas) AND relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c')
          ORDER BY relkind = 'S'
        LOOP
          CONTINUE WHEN (SELECT relowner FROM pg_class WHERE oid = object.oid) <> me;
          EXECUTE format('ALTER %s %s OWNER TO ${APP_ROLE}', CASE object.relkind
            WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
            WHEN 'S' THEN 'SEQUENCE' WHEN 'c' THEN 'TYPE' ELSE 'TABLE' END, object.name);
        END LOOP;
        -- Enums, domains and ranges; an array type goes along with the type it holds.
        FOR object IN SELECT oid::regtype AS name FROM pg_type
          WHERE typowner = me AND typnamespace = ANY (schemas) AND typtype IN ('e', 'd', 'r')
        LOOP
          EXECUTE format('ALTER TYPE %s OWNER TO ${APP_ROLE}', object.name);
        END LOOP;
        FOR object IN SELECT oid::regprocedure AS name FROM pg_proc
          WHERE proowner = me AND pronamespace = ANY (schemas) AND prokind <> 'a'
        LOOP
          EXECUTE format('ALTER ROUTINE %s OWNER TO ${APP_ROLE}', object.name);
        END LOOP;
        IF EXISTS (SELECT FROM pg_class WHERE relowner = me AND relnamespace = ANY (schemas))
          OR EXISTS (SELECT FROM pg_type WHERE typowner = me AND typnamespace = ANY (schemas))
          OR EXISTS (SELECT FROM pg_proc WHERE proowner = me AND pronamespace = ANY (schemas))
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
