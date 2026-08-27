-- Classes module: a single live session linked to a course/batch.
-- Holds the Zoom/meeting link and the recording link for that session.
CREATE TABLE IF NOT EXISTS `classes` (
  `id` VARCHAR(255) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `courseId` VARCHAR(255) NOT NULL,
  `batchId` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `scheduledAt` DATETIME NOT NULL,
  `durationMinutes` INT DEFAULT 60,
  `zoomLink` VARCHAR(500),
  `zoomMeetingId` VARCHAR(64),
  `zoomPasscode` VARCHAR(64),
  `recordingUrl` VARCHAR(500),
  `meetingUuid` VARCHAR(255),
  `status` VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  `showToAllUsers` BOOLEAN DEFAULT TRUE,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_classes_courseId` (`courseId`),
  INDEX `idx_classes_batchId` (`batchId`),
  INDEX `idx_classes_scheduledAt` (`scheduledAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
