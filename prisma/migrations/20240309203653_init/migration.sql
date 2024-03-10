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
    "available_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_date" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL,
    "lock_version" INTEGER NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_preview_thumbnails" (
    "video_id" UUID NOT NULL,
    "image_file_id" UUID NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "video_preview_thumbnails_pkey" PRIMARY KEY ("video_id")
);

-- CreateTable
CREATE TABLE "processed_videos" (
    "id" UUID NOT NULL,
    "video_file_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "video_id" UUID NOT NULL,

    CONSTRAINT "processed_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_processing_steps" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "video_id" UUID NOT NULL,

    CONSTRAINT "video_processing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_thumbnails" (
    "id" UUID NOT NULL,
    "image_file_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "video_id" UUID NOT NULL,

    CONSTRAINT "video_thumbnails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "videos_creator_id_idx" ON "videos" USING HASH ("creator_id");

-- CreateIndex
CREATE INDEX "processed_videos_video_id_idx" ON "processed_videos" USING HASH ("video_id");

-- CreateIndex
CREATE INDEX "video_processing_steps_video_id_idx" ON "video_processing_steps" USING HASH ("video_id");

-- CreateIndex
CREATE INDEX "video_thumbnails_video_id_idx" ON "video_thumbnails" USING HASH ("video_id");

-- AddForeignKey
ALTER TABLE "video_preview_thumbnails" ADD CONSTRAINT "video_preview_thumbnails_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_videos" ADD CONSTRAINT "processed_videos_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_processing_steps" ADD CONSTRAINT "video_processing_steps_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_thumbnails" ADD CONSTRAINT "video_thumbnails_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
