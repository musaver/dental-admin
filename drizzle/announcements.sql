-- Announcements module: admin broadcasts (title, description, link) to selected users,
-- emailed via Brevo and shown on the web /news page to each targeted user.
-- Collation matches existing tables (utf8mb4_unicode_ci) to avoid join collation errors.

CREATE TABLE IF NOT EXISTS `announcements` (
  `id` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `url` VARCHAR(500) NULL,
  `imageUrl` VARCHAR(500) NULL,
  `audience` VARCHAR(20) NOT NULL DEFAULT 'all',
  `courseId` VARCHAR(255) NULL,
  `batchId` VARCHAR(255) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'published',
  `emailSent` TINYINT(1) DEFAULT 0,
  `emailSentAt` DATETIME NULL,
  `recipientCount` INT DEFAULT 0,
  `createdBy` VARCHAR(255) NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_announcements_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcement_recipients` (
  `id` VARCHAR(255) NOT NULL,
  `announcementId` VARCHAR(255) NOT NULL,
  `userId` VARCHAR(255) NOT NULL,
  `emailedAt` DATETIME NULL,
  `readAt` DATETIME NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ann_recipients_announcementId` (`announcementId`),
  KEY `idx_ann_recipients_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
