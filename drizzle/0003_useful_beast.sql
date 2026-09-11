CREATE TABLE `discount_codes` (
	`id` varchar(255) NOT NULL,
	`code` varchar(30) NOT NULL,
	`description` varchar(255),
	`discountType` varchar(20) NOT NULL,
	`discountValue` int NOT NULL,
	`branchId` varchar(255),
	`validFrom` datetime,
	`validUntil` datetime,
	`maxRedemptions` int,
	`usedCount` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `discount_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `discount_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `discountCodeId` varchar(255);--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `uq_inv_code_patient` UNIQUE(`discountCodeId`,`patientId`);--> statement-breakpoint
CREATE INDEX `idx_dc_active` ON `discount_codes` (`isActive`,`validUntil`);--> statement-breakpoint
CREATE INDEX `idx_dc_branch` ON `discount_codes` (`branchId`);