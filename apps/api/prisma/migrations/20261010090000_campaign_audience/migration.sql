-- AlterTable
ALTER TABLE `campaigns` ADD COLUMN `skipped_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `audience` JSON NULL;
