ALTER TABLE "delivery_zones" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;