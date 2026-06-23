-- CreateEnum
CREATE TYPE "Category" AS ENUM ('billing', 'technical', 'complaint', 'feature_request', 'out_of_scope', 'unclear');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageResult" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "category" "Category" NOT NULL,
    "priority" "Priority" NOT NULL,
    "summary" VARCHAR(120) NOT NULL,
    "suggested_action" VARCHAR(200) NOT NULL,
    "needs_human" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "processing_time_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalLabel" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "expected_category" "Category" NOT NULL,
    "expected_priority" "Priority" NOT NULL,
    "expected_needs_human" BOOLEAN NOT NULL,
    "labeler" TEXT NOT NULL,
    "labeled_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_created_at_idx" ON "Message"("created_at");

-- CreateIndex
CREATE INDEX "TriageResult_message_id_idx" ON "TriageResult"("message_id");

-- CreateIndex
CREATE INDEX "TriageResult_category_idx" ON "TriageResult"("category");

-- CreateIndex
CREATE INDEX "TriageResult_priority_idx" ON "TriageResult"("priority");

-- CreateIndex
CREATE INDEX "TriageResult_needs_human_idx" ON "TriageResult"("needs_human");

-- CreateIndex
CREATE INDEX "TriageResult_created_at_idx" ON "TriageResult"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "EvalLabel_message_id_key" ON "EvalLabel"("message_id");

-- AddForeignKey
ALTER TABLE "TriageResult" ADD CONSTRAINT "TriageResult_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalLabel" ADD CONSTRAINT "EvalLabel_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
