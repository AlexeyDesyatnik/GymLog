CREATE TABLE "logins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"login_key" text NOT NULL,
	"password_hash" text,
	CONSTRAINT "logins_login_key_unique" UNIQUE("login_key")
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sign_in_attempts" (
	"login_key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "logins" ADD CONSTRAINT "logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Accounts from before passwords keep the name they signed in with as their login, with no password until the owner's link sets one (ADR 0007).
INSERT INTO "logins" ("user_id", "login", "login_key")
SELECT "user_id", btrim("subject"), lower(regexp_replace(btrim("subject"), '\s+', ' ', 'g'))
FROM "identities" WHERE "provider" = 'test'
ON CONFLICT DO NOTHING;
