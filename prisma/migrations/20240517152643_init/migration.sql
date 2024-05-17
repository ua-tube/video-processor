-- CreateEnum
CREATE TYPE "video_processing_statuses" AS ENUM ('Pending', 'ProcessingThumbnails', 'ProcessingVideos', 'Processed', 'Failed');

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "creator_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "video_file_url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "status" "video_processing_statuses" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_processing_steps" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "video_id" UUID NOT NULL,

    CONSTRAINT "video_processing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "videos_creator_id_idx" ON "videos" USING HASH ("creator_id");

-- CreateIndex
CREATE INDEX "video_processing_steps_video_id_idx" ON "video_processing_steps" USING HASH ("video_id");

-- AddForeignKey
ALTER TABLE "video_processing_steps" ADD CONSTRAINT "video_processing_steps_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
