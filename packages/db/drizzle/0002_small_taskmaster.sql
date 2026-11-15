CREATE TABLE "github_installation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_user_installation_unique" UNIQUE("user_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_user_repo_unique" UNIQUE("user_id","github_repo_id")
);
--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_user_installation_fk" FOREIGN KEY ("user_id","installation_id") REFERENCES "public"."github_installation"("user_id","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installation_installation_id_idx" ON "github_installation" USING btree ("installation_id");