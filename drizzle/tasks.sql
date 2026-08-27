-- Tasks linked to a class + a shared comment thread.
-- Collation matches existing tables (utf8mb4_unicode_ci) to avoid join collation errors.

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `classId` VARCHAR(255) NOT NULL,
  `dueDate` DATETIME NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `priority` VARCHAR(20) DEFAULT 'normal',
  `attachmentUrl` VARCHAR(500) NULL,
  `announcementSent` TINYINT(1) DEFAULT 0,
  `createdBy` VARCHAR(255) NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_classId` (`classId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_comments` (
  `id` VARCHAR(255) NOT NULL,
  `taskId` VARCHAR(255) NOT NULL,
  `authorId` VARCHAR(255) NOT NULL,
  `authorType` VARCHAR(20) NOT NULL DEFAULT 'user',
  `authorName` VARCHAR(255) NULL,
  `comment` TEXT NOT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_comments_taskId` (`taskId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
