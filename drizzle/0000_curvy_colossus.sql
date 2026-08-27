CREATE TABLE `account` (
	`userId` varchar(255) NOT NULL,
	`type` varchar(255) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`providerAccountId` varchar(255) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` datetime,
	`token_type` varchar(255),
	`scope` varchar(255),
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `account_provider_providerAccountId_pk` PRIMARY KEY(`provider`,`providerAccountId`)
);
--> statement-breakpoint
CREATE TABLE `admin_logs` (
	`id` varchar(255) NOT NULL,
	`adminId` varchar(255) NOT NULL,
	`action` varchar(255) NOT NULL,
	`details` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_roles` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`permissions` text NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`name` varchar(255),
	`roleId` varchar(255) NOT NULL,
	`role` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` varchar(255) NOT NULL,
	`batchName` varchar(255) NOT NULL,
	`courseId` varchar(255) NOT NULL,
	`startDate` datetime NOT NULL,
	`endDate` datetime NOT NULL,
	`capacity` int NOT NULL,
	`description` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` varchar(255) NOT NULL,
	`featured` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`image` varchar(255),
	`price` int NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `courses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` varchar(255) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`courseId` varchar(255) NOT NULL,
	`batchId` varchar(255),
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`transactionId` varchar(255),
	`transactionScreenshot` varchar(255),
	`firstName` varchar(100),
	`lastName` varchar(100),
	`email` varchar(255),
	`phone` varchar(20),
	`country` varchar(100),
	`address` varchar(255),
	`city` varchar(100),
	`state` varchar(100),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` varchar(255) NOT NULL,
	`recordingTitle` varchar(255) NOT NULL,
	`batchId` varchar(255) NOT NULL,
	`recordingDateTime` datetime NOT NULL,
	`recordingUrl` varchar(500),
	`showToAllUsers` boolean DEFAULT true,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recordings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sessionToken` varchar(255) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`expires` datetime NOT NULL,
	CONSTRAINT `sessions_sessionToken` PRIMARY KEY(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255),
	`first_name` varchar(100),
	`last_name` varchar(100),
	`email` varchar(255) NOT NULL,
	`emailVerified` datetime,
	`image` text,
	`profile_picture` varchar(255),
	`username` varchar(100),
	`display_name` varchar(100),
	`skill` varchar(100),
	`occupation` varchar(100),
	`country` varchar(100),
	`city` varchar(100),
	`address` varchar(100),
	`state` varchar(100),
	`about_me` text,
	`newsletter` boolean DEFAULT false,
	`phone` varchar(20),
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`otp` varchar(255) NOT NULL,
	`expires` datetime NOT NULL,
	CONSTRAINT `verification_tokens_identifier_token_otp_pk` PRIMARY KEY(`identifier`,`token`,`otp`)
);
--> statement-breakpoint
CREATE TABLE `zoom_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` varchar(500) NOT NULL,
	`batchId` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `zoom_links_id` PRIMARY KEY(`id`)
);
