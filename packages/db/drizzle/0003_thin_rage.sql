ALTER TABLE "run" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_project_id_idx" ON "run" USING btree ("project_id");