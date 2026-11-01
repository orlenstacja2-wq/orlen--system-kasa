CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"important" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"author_id" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY,
	"login" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"role" text DEFAULT 'pracownik' NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_prices" (
	"fuel_id" text PRIMARY KEY,
	"price" numeric(10,3) NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuelings" (
	"id" serial PRIMARY KEY,
	"client_ref" text NOT NULL UNIQUE,
	"shift_id" integer NOT NULL,
	"register_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"doc_number" text NOT NULL UNIQUE,
	"doc_type" text NOT NULL,
	"pump" integer NOT NULL,
	"fuel_id" text NOT NULL,
	"fuel_name" text NOT NULL,
	"liters" numeric(10,2) NOT NULL,
	"price_per_liter" numeric(10,3) NOT NULL,
	"gross_amount" numeric(12,2) NOT NULL,
	"discount_amount" numeric(12,2) DEFAULT '0' NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"promotion_id" integer,
	"promotion_snapshot" jsonb,
	"payment" text NOT NULL,
	"cash_given" numeric(12,2),
	"change" numeric(12,2),
	"vitay_mode" text NOT NULL,
	"vitay_card_masked" text,
	"vitay_test" boolean DEFAULT false NOT NULL,
	"vitay_phone_masked" text,
	"nip" text,
	"company" text,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_events" (
	"id" serial PRIMARY KEY,
	"promotion_id" integer NOT NULL,
	"action" text NOT NULL,
	"employee_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"fuel_ids" jsonb DEFAULT '[]' NOT NULL,
	"discount_type" text DEFAULT 'info' NOT NULL,
	"discount_value" numeric(10,3) DEFAULT '0' NOT NULL,
	"requires_vitay" boolean DEFAULT false NOT NULL,
	"min_liters" numeric(10,2),
	"conditions" text DEFAULT '' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_changes" (
	"id" serial PRIMARY KEY,
	"shift_id" integer NOT NULL,
	"from_register_id" integer NOT NULL,
	"to_register_id" integer NOT NULL,
	"reason" text NOT NULL,
	"approved_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registers" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"employee_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY,
	"employee_id" integer NOT NULL,
	"register_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"opening_note" text,
	"closing_note" text
);
--> statement-breakpoint
CREATE TABLE "station_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fuelings_shift_idx" ON "fuelings" ("shift_id");--> statement-breakpoint
CREATE INDEX "fuelings_created_idx" ON "fuelings" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_open_employee_idx" ON "shifts" ("employee_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_open_register_idx" ON "shifts" ("register_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "shifts_started_idx" ON "shifts" ("started_at");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_employees_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "fuelings" ADD CONSTRAINT "fuelings_shift_id_shifts_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id");--> statement-breakpoint
ALTER TABLE "fuelings" ADD CONSTRAINT "fuelings_register_id_registers_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id");--> statement-breakpoint
ALTER TABLE "fuelings" ADD CONSTRAINT "fuelings_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "fuelings" ADD CONSTRAINT "fuelings_promotion_id_promotions_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id");--> statement-breakpoint
ALTER TABLE "fuelings" ADD CONSTRAINT "fuelings_cancelled_by_employees_id_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_promotion_id_promotions_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id");--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_employees_id_fkey" FOREIGN KEY ("created_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "register_changes" ADD CONSTRAINT "register_changes_shift_id_shifts_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id");--> statement-breakpoint
ALTER TABLE "register_changes" ADD CONSTRAINT "register_changes_from_register_id_registers_id_fkey" FOREIGN KEY ("from_register_id") REFERENCES "registers"("id");--> statement-breakpoint
ALTER TABLE "register_changes" ADD CONSTRAINT "register_changes_to_register_id_registers_id_fkey" FOREIGN KEY ("to_register_id") REFERENCES "registers"("id");--> statement-breakpoint
ALTER TABLE "register_changes" ADD CONSTRAINT "register_changes_approved_by_employees_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_employees_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_registers_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id");--> statement-breakpoint
ALTER TABLE "station_settings" ADD CONSTRAINT "station_settings_updated_by_employees_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "employees"("id");