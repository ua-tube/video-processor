/*
  Warnings:

  - Added the required column `width` to the `video_processing_steps` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "video_processing_steps" ADD COLUMN     "width" INTEGER NOT NULL;
