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
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`branchId` varchar(255),
	`phone` varchar(20),
	`staffType` varchar(20) DEFAULT 'other',
	`licenseNumber` varchar(50),
	`signatureUrl` varchar(500),
	`isActive` boolean DEFAULT true,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`dentistId` varchar(255) NOT NULL,
	`chairId` varchar(255),
	`startAt` datetime NOT NULL,
	`endAt` datetime NOT NULL,
	`type` varchar(20) NOT NULL DEFAULT 'procedure',
	`status` varchar(20) NOT NULL DEFAULT 'scheduled',
	`isWalkIn` boolean DEFAULT false,
	`treatmentPlanItemId` varchar(255),
	`recallId` varchar(255),
	`reasonNote` varchar(500),
	`cancellationReason` varchar(255),
	`cancelledBy` varchar(255),
	`cancelledAt` datetime,
	`confirmedAt` datetime,
	`checkedInAt` datetime,
	`completedAt` datetime,
	`reminderEmailSentAt` datetime,
	`createdBy` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(255) NOT NULL,
	`actorId` varchar(255) NOT NULL,
	`actorEmail` varchar(255),
	`action` varchar(20) NOT NULL,
	`entityType` varchar(30) NOT NULL,
	`entityId` varchar(255),
	`patientId` varchar(255),
	`before` json,
	`after` json,
	`ipAddress` varchar(45),
	`userAgent` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`code` varchar(10) NOT NULL,
	`address` text,
	`city` varchar(100),
	`phone` varchar(20),
	`email` varchar(255),
	`timezone` varchar(50) DEFAULT 'Asia/Karachi',
	`isActive` boolean DEFAULT true,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `chairs` (
	`id` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`isActive` boolean DEFAULT true,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `chairs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clinic_settings` (
	`id` varchar(255) NOT NULL,
	`clinicName` varchar(255) NOT NULL DEFAULT 'Dental Clinic',
	`address` text,
	`phone` varchar(20),
	`email` varchar(255),
	`logoUrl` varchar(500),
	`workStartTime` varchar(5) DEFAULT '09:00',
	`workEndTime` varchar(5) DEFAULT '21:00',
	`slotMinutes` int DEFAULT 15,
	`currency` varchar(5) DEFAULT 'PKR',
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `clinic_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communication_logs` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255),
	`leadId` varchar(255),
	`channel` varchar(20) NOT NULL,
	`direction` varchar(10) NOT NULL DEFAULT 'outbound',
	`subject` varchar(255),
	`body` text,
	`status` varchar(20) NOT NULL DEFAULT 'logged',
	`referenceType` varchar(30),
	`referenceId` varchar(255),
	`performedBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `communication_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` varchar(255) NOT NULL,
	`invoiceId` varchar(255) NOT NULL,
	`procedureId` varchar(255),
	`visitProcedureId` varchar(255),
	`treatmentPlanItemId` varchar(255),
	`description` varchar(255) NOT NULL,
	`teeth` varchar(100),
	`quantity` int DEFAULT 1,
	`unitPrice` int NOT NULL,
	`discountAmount` int DEFAULT 0,
	`amount` int NOT NULL,
	`itemType` varchar(20) NOT NULL DEFAULT 'procedure',
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` varchar(255) NOT NULL,
	`invoiceNumber` varchar(30) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`visitId` varchar(255),
	`treatmentPlanId` varchar(255),
	`issueDate` datetime DEFAULT CURRENT_TIMESTAMP,
	`dueDate` datetime,
	`subtotal` int NOT NULL,
	`discountTotal` int DEFAULT 0,
	`totalAmount` int NOT NULL,
	`paidAmount` int DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'unpaid',
	`notes` text,
	`createdBy` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `lead_activities` (
	`id` varchar(255) NOT NULL,
	`leadId` varchar(255) NOT NULL,
	`activityType` varchar(20) NOT NULL,
	`note` text,
	`outcome` varchar(20),
	`performedBy` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `lead_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`email` varchar(255),
	`source` varchar(20) NOT NULL DEFAULT 'walk_in',
	`interestedProcedureId` varchar(255),
	`interestNote` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'new',
	`lostReason` varchar(255),
	`assignedTo` varchar(255),
	`nextFollowUpAt` datetime,
	`convertedPatientId` varchar(255),
	`convertedAt` datetime,
	`createdBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`ipAddress` varchar(45),
	`success` boolean DEFAULT false,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(255) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`type` varchar(30) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text,
	`link` varchar(500),
	`imageUrl` varchar(500),
	`referenceId` varchar(255),
	`isRead` boolean DEFAULT false,
	`readAt` datetime,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patient_conditions` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`conditionType` varchar(20) NOT NULL,
	`name` varchar(255) NOT NULL,
	`severity` varchar(20),
	`isAlert` boolean DEFAULT false,
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`recordedBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `patient_conditions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patient_files` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`visitId` varchar(255),
	`toothNumber` varchar(2),
	`fileType` varchar(20) NOT NULL,
	`photoStage` varchar(10),
	`pairId` varchar(255),
	`title` varchar(255),
	`storageKey` varchar(500) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`sizeBytes` int,
	`uploadedBy` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `patient_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` varchar(255) NOT NULL,
	`mrn` varchar(20) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100),
	`gender` varchar(10),
	`dateOfBirth` datetime,
	`cnic` varchar(15),
	`phone` varchar(20) NOT NULL,
	`altPhone` varchar(20),
	`email` varchar(255),
	`address` text,
	`city` varchar(100),
	`emergencyContactName` varchar(255),
	`emergencyContactPhone` varchar(20),
	`emergencyContactRelation` varchar(50),
	`guardianName` varchar(255),
	`bloodGroup` varchar(5),
	`occupation` varchar(100),
	`referredBy` varchar(255),
	`leadId` varchar(255),
	`defaultDiscountPercent` int DEFAULT 0,
	`medicalNotes` text,
	`dentalNotes` text,
	`hasAlerts` boolean DEFAULT false,
	`portalUserId` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`registeredBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_mrn_unique` UNIQUE(`mrn`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`invoiceId` varchar(255),
	`amount` int NOT NULL,
	`type` varchar(20) NOT NULL DEFAULT 'payment',
	`method` varchar(30),
	`transactionId` varchar(255),
	`paymentDate` datetime DEFAULT CURRENT_TIMESTAMP,
	`notes` text,
	`recordedBy` varchar(255) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prescription_items` (
	`id` varchar(255) NOT NULL,
	`prescriptionId` varchar(255) NOT NULL,
	`drugName` varchar(255) NOT NULL,
	`dosage` varchar(100),
	`frequency` varchar(100),
	`durationDays` int,
	`instructions` varchar(255),
	`sortOrder` int DEFAULT 0,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `prescription_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prescriptions` (
	`id` varchar(255) NOT NULL,
	`visitId` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`dentistId` varchar(255) NOT NULL,
	`notes` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `prescriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `procedures` (
	`id` varchar(255) NOT NULL,
	`code` varchar(20),
	`name` varchar(255) NOT NULL,
	`category` varchar(30) NOT NULL,
	`defaultPrice` int NOT NULL,
	`durationMinutes` int DEFAULT 30,
	`isPerTooth` boolean DEFAULT true,
	`defaultRecallMonths` int,
	`isActive` boolean DEFAULT true,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `procedures_id` PRIMARY KEY(`id`),
	CONSTRAINT `procedures_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `recalls` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`recallType` varchar(30) NOT NULL,
	`dueDate` datetime NOT NULL,
	`intervalMonths` int,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`appointmentId` varchar(255),
	`sourceVisitId` varchar(255),
	`notes` varchar(500),
	`createdBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recalls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sessionToken` varchar(255) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`expires` datetime NOT NULL,
	CONSTRAINT `sessions_sessionToken` PRIMARY KEY(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `staff_schedules` (
	`id` varchar(255) NOT NULL,
	`staffId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`dayOfWeek` int NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`isActive` boolean DEFAULT true,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `staff_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_time_off` (
	`id` varchar(255) NOT NULL,
	`staffId` varchar(255) NOT NULL,
	`startDate` datetime NOT NULL,
	`endDate` datetime NOT NULL,
	`reason` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `staff_time_off_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` varchar(255) NOT NULL,
	`taskId` varchar(255) NOT NULL,
	`authorId` varchar(255) NOT NULL,
	`authorType` varchar(20) NOT NULL DEFAULT 'admin',
	`authorName` varchar(255),
	`comment` text NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `task_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`patientId` varchar(255),
	`leadId` varchar(255),
	`branchId` varchar(255),
	`assignedTo` varchar(255),
	`dueDate` datetime,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`priority` varchar(20) DEFAULT 'normal',
	`createdBy` varchar(255),
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tooth_conditions` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`toothNumber` varchar(2) NOT NULL,
	`surfaces` varchar(10),
	`conditionType` varchar(30) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`notes` text,
	`visitId` varchar(255),
	`diagnosisId` varchar(255),
	`treatmentPlanItemId` varchar(255),
	`resolvedByVisitId` varchar(255),
	`resolvedAt` datetime,
	`recordedBy` varchar(255) NOT NULL,
	`recordedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `tooth_conditions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `treatment_plan_items` (
	`id` varchar(255) NOT NULL,
	`treatmentPlanId` varchar(255) NOT NULL,
	`procedureId` varchar(255) NOT NULL,
	`teeth` varchar(100),
	`surfaces` varchar(10),
	`toothConditionId` varchar(255),
	`unitPrice` int NOT NULL,
	`quantity` int DEFAULT 1,
	`discountType` varchar(20),
	`discountValue` int DEFAULT 0,
	`netAmount` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`appointmentId` varchar(255),
	`visitProcedureId` varchar(255),
	`sortOrder` int DEFAULT 0,
	`notes` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `treatment_plan_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `treatment_plans` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`dentistId` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`totalAmount` int DEFAULT 0,
	`discountTotal` int DEFAULT 0,
	`netAmount` int DEFAULT 0,
	`proposedAt` datetime,
	`acceptedAt` datetime,
	`acceptedNote` varchar(255),
	`consentFileId` varchar(255),
	`cancelReason` varchar(255),
	`notes` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `treatment_plans_id` PRIMARY KEY(`id`)
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
	`country` varchar(100),
	`city` varchar(100),
	`address` varchar(100),
	`state` varchar(100),
	`phone` varchar(20),
	`otp` varchar(6),
	`otp_expiry` datetime,
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
CREATE TABLE `visit_diagnoses` (
	`id` varchar(255) NOT NULL,
	`visitId` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`toothNumber` varchar(2),
	`code` varchar(20),
	`description` varchar(500) NOT NULL,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `visit_diagnoses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visit_procedures` (
	`id` varchar(255) NOT NULL,
	`visitId` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`procedureId` varchar(255) NOT NULL,
	`treatmentPlanItemId` varchar(255),
	`teeth` varchar(100),
	`surfaces` varchar(10),
	`performedBy` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'completed',
	`price` int NOT NULL,
	`notes` text,
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `visit_procedures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` varchar(255) NOT NULL,
	`patientId` varchar(255) NOT NULL,
	`branchId` varchar(255) NOT NULL,
	`appointmentId` varchar(255),
	`dentistId` varchar(255) NOT NULL,
	`visitDate` datetime NOT NULL,
	`chiefComplaint` text,
	`examinationNotes` text,
	`treatmentNotes` text,
	`bloodPressure` varchar(10),
	`followUpInstructions` text,
	`status` varchar(20) NOT NULL DEFAULT 'in_progress',
	`createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `visits_id` PRIMARY KEY(`id`)
);
