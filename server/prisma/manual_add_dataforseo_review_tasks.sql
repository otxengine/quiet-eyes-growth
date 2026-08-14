-- Adds the DataForSeoReviewTask table (server/prisma/schema.prisma).
-- Run this against each environment's DB (local, dev, prod) before enabling
-- DATAFORSEO_REVIEWS_ENABLED=true there.

-- CreateTable
CREATE TABLE "dataforseo_review_tasks" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "business_profile_id" TEXT NOT NULL,
    "linked_competitor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "cost_usd" DOUBLE PRECISION,
    "new_reviews_count" INTEGER,

    CONSTRAINT "dataforseo_review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataforseo_review_tasks_task_id_key" ON "dataforseo_review_tasks"("task_id");

-- CreateIndex
CREATE INDEX "dataforseo_review_tasks_status_requested_at_idx" ON "dataforseo_review_tasks"("status", "requested_at");
