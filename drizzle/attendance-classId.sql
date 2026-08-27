-- Link attendance rows to a specific class (class-based Zoom attendance).
-- Nullable so existing self/batch rows are unaffected. Run ONCE on the shared DB.
-- MySQL 8 supports IF NOT EXISTS; on older MySQL drop that clause.

ALTER TABLE `attendance`
  ADD COLUMN IF NOT EXISTS `classId` VARCHAR(255) NULL AFTER `batchId`;

-- Speeds up the per-class upsert lookup during sync.
CREATE INDEX `idx_attendance_user_class_meeting`
  ON `attendance` (`userId`, `classId`, `meetingUuid`);
