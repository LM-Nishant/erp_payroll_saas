-- CreateTable
CREATE TABLE `student_previous_schools` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `admission_application_id` CHAR(36) NULL,
    `school_name` VARCHAR(200) NOT NULL,
    `board` VARCHAR(80) NULL,
    `location` VARCHAR(200) NULL,
    `last_class` VARCHAR(60) NULL,
    `last_academic_year` VARCHAR(9) NULL,
    `marks_percent` DECIMAL(5, 2) NULL,
    `grade` VARCHAR(20) NULL,
    `tc_number` VARCHAR(60) NULL,
    `tc_date` DATE NULL,
    `tc_document_id` CHAR(36) NULL,
    `remarks` VARCHAR(500) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `student_previous_schools_organization_id_student_id_idx`(`organization_id`, `student_id`),
    INDEX `student_previous_schools_organization_id_admission_applicati_idx`(`organization_id`, `admission_application_id`),
    INDEX `student_previous_schools_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `student_previous_schools_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_certificate_series` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `type` ENUM('TRANSFER', 'CHARACTER') NOT NULL,
    `year` INTEGER NOT NULL,
    `prefix` VARCHAR(60) NOT NULL,
    `padding` INTEGER NOT NULL DEFAULT 4,
    `next_number` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_certificate_series_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `student_certificate_series_organization_id_institution_id_ty_key`(`organization_id`, `institution_id`, `type`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_certificates` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `certificate_no` VARCHAR(80) NOT NULL,
    `type` ENUM('TRANSFER', 'CHARACTER') NOT NULL,
    `status` ENUM('ISSUED', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    `student_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `issue_date` DATE NOT NULL,
    `leaving_date` DATE NULL,
    `reason` VARCHAR(300) NULL,
    `conduct` VARCHAR(60) NOT NULL,
    `last_class` VARCHAR(120) NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `promotion_status` VARCHAR(120) NULL,
    `remarks` VARCHAR(1000) NULL,
    `fee_dues_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `fee_dues_waived` BOOLEAN NOT NULL DEFAULT false,
    `fee_dues_waiver_reason` VARCHAR(500) NULL,
    `document_id` CHAR(36) NULL,
    `issued_by_id` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_id` CHAR(36) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `replaces_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `student_certificates_organization_id_student_id_type_status_idx`(`organization_id`, `student_id`, `type`, `status`),
    INDEX `student_certificates_organization_id_institution_id_type_idx`(`organization_id`, `institution_id`, `type`),
    INDEX `student_certificates_organization_id_replaces_id_idx`(`organization_id`, `replaces_id`),
    INDEX `student_certificates_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `student_certificates_organization_id_certificate_no_key`(`organization_id`, `certificate_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `student_previous_schools` ADD CONSTRAINT `student_previous_schools_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_previous_schools` ADD CONSTRAINT `student_previous_schools_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_previous_schools` ADD CONSTRAINT `student_previous_schools_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_previous_schools` ADD CONSTRAINT `student_previous_schools_admission_application_id_fkey` FOREIGN KEY (`admission_application_id`) REFERENCES `admission_applications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_previous_schools` ADD CONSTRAINT `student_previous_schools_tc_document_id_fkey` FOREIGN KEY (`tc_document_id`) REFERENCES `documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificate_series` ADD CONSTRAINT `student_certificate_series_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificate_series` ADD CONSTRAINT `student_certificate_series_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_replaces_id_fkey` FOREIGN KEY (`replaces_id`) REFERENCES `student_certificates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
