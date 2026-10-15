CREATE TABLE IF NOT EXISTS "stored_files" (
	"visibility" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"body" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_visibility_key_pk" PRIMARY KEY("visibility","key")
);
