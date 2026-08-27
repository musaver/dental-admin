-- Fee Calculations module: schema (run ONCE on the shared MySQL database).
-- All monetary amounts are whole PKR (INT), matching `courses.price`.

CREATE TABLE IF NOT EXISTS `fee_structures` (
  `id` VARCHAR(255) NOT NULL,
  `courseId` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `billingCycle` VARCHAR(20) NOT NULL DEFAULT 'monthly',
  `baseAmount` INT NOT NULL,
  `dueDayOfMonth` INT NULL,
  `isActive` BOOLEAN DEFAULT TRUE,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_structures_course` (`courseId`)
);

CREATE TABLE IF NOT EXISTS `fee_components` (
  `id` VARCHAR(255) NOT NULL,
  `feeStructureId` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `amount` INT NOT NULL,
  `frequency` VARCHAR(20) NOT NULL DEFAULT 'recurring',
  `isActive` BOOLEAN DEFAULT TRUE,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_components_structure` (`feeStructureId`)
);

CREATE TABLE IF NOT EXISTS `fee_discounts` (
  `id` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `scope` VARCHAR(20) NOT NULL,
  `userId` VARCHAR(255) NULL,
  `courseId` VARCHAR(255) NULL,
  `batchId` VARCHAR(255) NULL,
  `discountType` VARCHAR(20) NOT NULL,
  `value` INT NOT NULL,
  `isActive` BOOLEAN DEFAULT TRUE,
  `validFrom` DATETIME NULL,
  `validTo` DATETIME NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_discounts_user` (`userId`),
  KEY `idx_fee_discounts_batch` (`batchId`),
  KEY `idx_fee_discounts_course` (`courseId`)
);

CREATE TABLE IF NOT EXISTS `fee_invoices` (
  `id` VARCHAR(255) NOT NULL,
  `userId` VARCHAR(255) NOT NULL,
  `courseId` VARCHAR(255) NOT NULL,
  `batchId` VARCHAR(255) NULL,
  `orderId` VARCHAR(255) NULL,
  `period` VARCHAR(7) NOT NULL,
  `issueDate` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `dueDate` DATETIME NULL,
  `baseAmount` INT NOT NULL,
  `componentsTotal` INT DEFAULT 0,
  `discountTotal` INT DEFAULT 0,
  `totalAmount` INT NOT NULL,
  `paidAmount` INT DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  `notes` TEXT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fee_invoice_student_batch_period` (`userId`, `batchId`, `period`),
  KEY `idx_fee_invoices_batch` (`batchId`),
  KEY `idx_fee_invoices_status` (`status`)
);

CREATE TABLE IF NOT EXISTS `fee_invoice_items` (
  `id` VARCHAR(255) NOT NULL,
  `invoiceId` VARCHAR(255) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `itemType` VARCHAR(20) NOT NULL,
  `amount` INT NOT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_invoice_items_invoice` (`invoiceId`)
);

CREATE TABLE IF NOT EXISTS `fee_payments` (
  `id` VARCHAR(255) NOT NULL,
  `invoiceId` VARCHAR(255) NOT NULL,
  `userId` VARCHAR(255) NOT NULL,
  `amount` INT NOT NULL,
  `type` VARCHAR(20) NOT NULL DEFAULT 'payment',
  `method` VARCHAR(30) NULL,
  `transactionId` VARCHAR(255) NULL,
  `transactionScreenshot` VARCHAR(500) NULL,
  `paymentDate` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `notes` TEXT NULL,
  `recordedBy` VARCHAR(255) NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fee_payments_invoice` (`invoiceId`)
);

-- NOTE: the UNIQUE KEY on fee_invoices treats NULL batchId as distinct (MySQL allows
-- multiple NULLs). Generation always passes a concrete batchId, so this is fine.
