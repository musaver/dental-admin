-- Link recordings to the new Classes module.
-- Adds an optional classId to the recordings table (legacy rows keep batchId only).
ALTER TABLE `recordings`
  ADD COLUMN `classId` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER `batchId`,
  ADD INDEX `idx_recordings_classId` (`classId`);
