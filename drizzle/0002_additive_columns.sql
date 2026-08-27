CREATE TABLE `message_templates` (
	`id` varchar(255) NOT NULL,
	`branchId` varchar(255),
	`templateKey` varchar(60) NOT NULL,
	`subject` varchar(255),
	`bodyHtml` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`updatedBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `message_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_templates_branch_key_unique` UNIQUE(`branchId`,`templateKey`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` varchar(255) NOT NULL,
	`adminUserId` varchar(255) NOT NULL,
	`prefKey` varchar(60) NOT NULL,
	`value` json,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_preferences_user_key_unique` UNIQUE(`adminUserId`,`prefKey`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `branchId` varchar(255);--> statement-breakpoint
ALTER TABLE `communication_logs` ADD `templateKey` varchar(60);--> statement-breakpoint
ALTER TABLE `communication_logs` ADD `providerMessageId` varchar(255);--> statement-breakpoint
ALTER TABLE `leads` ADD `metadata` json;--> statement-breakpoint
ALTER TABLE `notifications` ADD `userType` varchar(10) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_mt_key` ON `message_templates` (`templateKey`);