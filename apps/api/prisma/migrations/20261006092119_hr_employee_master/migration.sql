-- CreateTable
CREATE TABLE `designations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING') NULL,
    `level` INTEGER NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `designations_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `designations_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `designations_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_code_sequences` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL,
    `padding` INTEGER NOT NULL DEFAULT 4,
    `next_number` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_code_sequences_organization_id_scope_key_key`(`organization_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_code` VARCHAR(40) NOT NULL,
    `user_id` CHAR(36) NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `designation_id` CHAR(36) NULL,
    `reporting_manager_id` CHAR(36) NULL,
    `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING') NOT NULL,
    `status` ENUM('DRAFT', 'ONBOARDING', 'ACTIVE', 'ON_NOTICE', 'EXITED') NOT NULL DEFAULT 'DRAFT',
    `first_name` VARCHAR(100) NOT NULL,
    `middle_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `display_name` VARCHAR(200) NOT NULL,
    `work_email` VARCHAR(254) NULL,
    `work_phone` VARCHAR(32) NULL,
    `date_of_joining` DATE NULL,
    `probation_end_date` DATE NULL,
    `confirmation_date` DATE NULL,
    `notice_period_days` INTEGER NULL,
    `resignation_date` DATE NULL,
    `last_working_date` DATE NULL,
    `exit_date` DATE NULL,
    `exit_type` VARCHAR(32) NULL,
    `exit_reason` VARCHAR(1000) NULL,
    `rehire_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `employees_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `employees_organization_id_group_id_idx`(`organization_id`, `group_id`),
    INDEX `employees_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `employees_organization_id_reporting_manager_id_idx`(`organization_id`, `reporting_manager_id`),
    INDEX `employees_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `employees_organization_id_employee_code_key`(`organization_id`, `employee_code`),
    UNIQUE INDEX `employees_organization_id_user_id_key`(`organization_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_profiles` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `date_of_birth` DATE NULL,
    `gender` VARCHAR(16) NULL,
    `marital_status` VARCHAR(16) NULL,
    `blood_group` VARCHAR(8) NULL,
    `nationality` VARCHAR(64) NULL,
    `personal_email` VARCHAR(254) NULL,
    `personal_phone` VARCHAR(32) NULL,
    `addresses` JSON NULL,
    `emergency_contacts` JSON NULL,
    `family` JSON NULL,
    `qualifications` JSON NULL,
    `experience` JSON NULL,
    `sensitive_ciphertext` TEXT NULL,
    `sensitive_wrapped_key` VARCHAR(512) NULL,
    `sensitive_key_version` INTEGER NULL,
    `sensitive_key_provider` VARCHAR(32) NULL,
    `sensitive_masked` JSON NULL,
    `pan_index` VARCHAR(64) NULL,
    `aadhaar_index` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_profiles_employee_id_key`(`employee_id`),
    UNIQUE INDEX `employee_profiles_organization_id_pan_index_key`(`organization_id`, `pan_index`),
    UNIQUE INDEX `employee_profiles_organization_id_aadhaar_index_key`(`organization_id`, `aadhaar_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_positions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `designation_id` CHAR(36) NULL,
    `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING') NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `reason` VARCHAR(500) NULL,
    `movement_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_positions_organization_id_employee_id_effective_fro_idx`(`organization_id`, `employee_id`, `effective_from`),
    INDEX `employee_positions_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_departments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `movement_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_departments_organization_id_employee_id_effective_f_idx`(`organization_id`, `employee_id`, `effective_from`),
    INDEX `employee_departments_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `employee_departments_organization_id_department_id_idx`(`organization_id`, `department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_reporting_lines` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `manager_id` CHAR(36) NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `movement_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_reporting_lines_organization_id_employee_id_effecti_idx`(`organization_id`, `employee_id`, `effective_from`),
    INDEX `employee_reporting_lines_organization_id_manager_id_idx`(`organization_id`, `manager_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_movements` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `type` ENUM('TRANSFER', 'PROMOTION', 'DESIGNATION_CHANGE', 'DEPARTMENT_CHANGE', 'REPORTING_CHANGE', 'REHIRE') NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'SCHEDULED', 'APPLIED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `effective_date` DATE NOT NULL,
    `from_group_id` CHAR(36) NULL,
    `from_institution_id` CHAR(36) NOT NULL,
    `from_campus_id` CHAR(36) NULL,
    `from_department_id` CHAR(36) NULL,
    `from_designation_id` CHAR(36) NULL,
    `from_reporting_manager_id` CHAR(36) NULL,
    `to_group_id` CHAR(36) NULL,
    `to_institution_id` CHAR(36) NOT NULL,
    `to_campus_id` CHAR(36) NULL,
    `to_department_id` CHAR(36) NULL,
    `to_designation_id` CHAR(36) NULL,
    `to_reporting_manager_id` CHAR(36) NULL,
    `reason` VARCHAR(1000) NULL,
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `applied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_movements_organization_id_employee_id_effective_dat_idx`(`organization_id`, `employee_id`, `effective_date`),
    INDEX `employee_movements_organization_id_status_effective_date_idx`(`organization_id`, `status`, `effective_date`),
    INDEX `employee_movements_organization_id_from_institution_id_idx`(`organization_id`, `from_institution_id`),
    INDEX `employee_movements_organization_id_to_institution_id_idx`(`organization_id`, `to_institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_salary_history` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `effective_from` DATE NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `annual_ctc` DECIMAL(14, 2) NOT NULL,
    `amounts` JSON NOT NULL,
    `salary_structure_id` VARCHAR(64) NULL,
    `revision_reason` VARCHAR(500) NOT NULL,
    `previous_id` CHAR(36) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_salary_history_organization_id_employee_id_effectiv_idx`(`organization_id`, `employee_id`, `effective_from`),
    INDEX `employee_salary_history_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_checklist_items` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `kind` ENUM('ONBOARDING', 'EXIT') NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `source` VARCHAR(64) NOT NULL DEFAULT 'default',
    `status` ENUM('PENDING', 'DONE', 'WAIVED') NOT NULL DEFAULT 'PENDING',
    `notes` VARCHAR(1000) NULL,
    `completed_at` DATETIME(3) NULL,
    `completed_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_checklist_items_organization_id_employee_id_kind_ke_key`(`organization_id`, `employee_id`, `kind`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_profile_change_requests` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPLIED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `changes` JSON NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `applied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_profile_change_requests_organization_id_employee_id_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_import_jobs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `file_name` VARCHAR(255) NOT NULL,
    `dry_run` BOOLEAN NOT NULL DEFAULT false,
    `input` MEDIUMTEXT NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `created_count` INTEGER NOT NULL DEFAULT 0,
    `error_count` INTEGER NOT NULL DEFAULT 0,
    `report` JSON NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_import_jobs_organization_id_created_at_idx`(`organization_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `designations` ADD CONSTRAINT `designations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_code_sequences` ADD CONSTRAINT `employee_code_sequences_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `designations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_reporting_manager_id_fkey` FOREIGN KEY (`reporting_manager_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_profiles` ADD CONSTRAINT `employee_profiles_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_profiles` ADD CONSTRAINT `employee_profiles_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_positions` ADD CONSTRAINT `employee_positions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_positions` ADD CONSTRAINT `employee_positions_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_positions` ADD CONSTRAINT `employee_positions_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `designations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_departments` ADD CONSTRAINT `employee_departments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_departments` ADD CONSTRAINT `employee_departments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_reporting_lines` ADD CONSTRAINT `employee_reporting_lines_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_reporting_lines` ADD CONSTRAINT `employee_reporting_lines_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_reporting_lines` ADD CONSTRAINT `employee_reporting_lines_manager_id_fkey` FOREIGN KEY (`manager_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_movements` ADD CONSTRAINT `employee_movements_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_movements` ADD CONSTRAINT `employee_movements_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_salary_history` ADD CONSTRAINT `employee_salary_history_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_salary_history` ADD CONSTRAINT `employee_salary_history_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_checklist_items` ADD CONSTRAINT `employee_checklist_items_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_checklist_items` ADD CONSTRAINT `employee_checklist_items_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_profile_change_requests` ADD CONSTRAINT `employee_profile_change_requests_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_profile_change_requests` ADD CONSTRAINT `employee_profile_change_requests_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_import_jobs` ADD CONSTRAINT `employee_import_jobs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Salary history is immutable: a revision is always a NEW row (Layer 8 payroll relies on it).
CREATE TRIGGER `employee_salary_history_no_update` BEFORE UPDATE ON `employee_salary_history`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'employee_salary_history is immutable';

CREATE TRIGGER `employee_salary_history_no_delete` BEFORE DELETE ON `employee_salary_history`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'employee_salary_history is immutable';
