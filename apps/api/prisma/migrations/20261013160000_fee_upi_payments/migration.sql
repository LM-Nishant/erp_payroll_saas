-- CreateTable
CREATE TABLE `fee_upi_settings` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `upi_id` VARCHAR(100) NOT NULL,
    `payee_name` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updated_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_upi_settings_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `fee_upi_settings_organization_id_institution_id_key`(`organization_id`, `institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_upi_payments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `student_id` CHAR(36) NOT NULL,
    `invoice_ids` JSON NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `utr` VARCHAR(64) NOT NULL,
    `paid_on` DATE NOT NULL,
    `upi_id` VARCHAR(100) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `payment_id` CHAR(36) NULL,
    `remarks` VARCHAR(500) NULL,
    `submitted_by_user_id` CHAR(36) NULL,
    `reviewed_by_user_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_upi_payments_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `fee_upi_payments_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `fee_upi_payments_organization_id_utr_idx`(`organization_id`, `utr`),
    INDEX `fee_upi_payments_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fee_upi_settings` ADD CONSTRAINT `fee_upi_settings_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_upi_settings` ADD CONSTRAINT `fee_upi_settings_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_upi_payments` ADD CONSTRAINT `fee_upi_payments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_upi_payments` ADD CONSTRAINT `fee_upi_payments_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_upi_payments` ADD CONSTRAINT `fee_upi_payments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

