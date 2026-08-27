-- In-app notifications: one row per user per event (announcement sent, class added, ...).
-- Powers the web header bell (unread count) and the /news feed.
-- Collation matches existing tables (utf8mb4_unicode_ci) to avoid join collation errors.

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(255) NOT NULL,
  `userId` VARCHAR(255) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NULL,
  `link` VARCHAR(500) NULL,
  `imageUrl` VARCHAR(500) NULL,
  `referenceId` VARCHAR(255) NULL,
  `isRead` TINYINT(1) DEFAULT 0,
  `readAt` DATETIME NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_userId` (`userId`),
  KEY `idx_notifications_isRead` (`isRead`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
