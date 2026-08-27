ALTER TABLE `batches` MODIFY COLUMN `startDate` datetime;--> statement-breakpoint
ALTER TABLE `batches` MODIFY COLUMN `endDate` datetime;--> statement-breakpoint
ALTER TABLE `batches` MODIFY COLUMN `capacity` int;--> statement-breakpoint
ALTER TABLE `courses` MODIFY COLUMN `image` varchar(500);--> statement-breakpoint
ALTER TABLE `batches` ADD `image` varchar(500);