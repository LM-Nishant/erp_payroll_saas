-- CreateTable
CREATE TABLE `holiday_calendars` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION', 'CAMPUS') NOT NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `year` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `weekly_offs` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `holiday_calendars_organization_id_year_scope_idx`(`organization_id`, `year`, `scope`),
    INDEX `holiday_calendars_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `holiday_calendars_organization_id_scope_key_year_key`(`organization_id`, `scope_key`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `calendar_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('PUBLIC', 'RESTRICTED', 'OPTIONAL') NOT NULL DEFAULT 'PUBLIC',
    `removed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `holidays_organization_id_date_idx`(`organization_id`, `date`),
    UNIQUE INDEX `holidays_calendar_id_date_key`(`calendar_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shifts` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `start_minute` INTEGER NOT NULL,
    `end_minute` INTEGER NOT NULL,
    `crosses_midnight` BOOLEAN NOT NULL DEFAULT false,
    `grace_in_minutes` INTEGER NOT NULL DEFAULT 0,
    `grace_out_minutes` INTEGER NOT NULL DEFAULT 0,
    `break_minutes` INTEGER NOT NULL DEFAULT 0,
    `half_day_minutes` INTEGER NOT NULL DEFAULT 240,
    `full_day_minutes` INTEGER NOT NULL DEFAULT 480,
    `overtime_after_minutes` INTEGER NOT NULL DEFAULT 0,
    `weekly_offs` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shifts_organization_id_institution_id_is_default_idx`(`organization_id`, `institution_id`, `is_default`),
    UNIQUE INDEX `shifts_organization_id_institution_id_code_key`(`organization_id`, `institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_assignments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `shift_id` CHAR(36) NOT NULL,
    `rotation_shift_ids` JSON NULL,
    `rotation_days` INTEGER NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shift_assignments_organization_id_employee_id_effective_from_idx`(`organization_id`, `employee_id`, `effective_from`),
    INDEX `shift_assignments_organization_id_department_id_effective_fr_idx`(`organization_id`, `department_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_punches` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `punched_at` DATETIME(3) NOT NULL,
    `attendance_date` DATE NOT NULL,
    `direction` ENUM('IN', 'OUT', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `source` ENUM('WEB', 'MOBILE', 'BIOMETRIC', 'API', 'MANUAL') NOT NULL,
    `device_id` VARCHAR(100) NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `accuracy_meters` DECIMAL(10, 2) NULL,
    `import_job_id` CHAR(36) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_punches_organization_id_employee_id_attendance_da_idx`(`organization_id`, `employee_id`, `attendance_date`),
    UNIQUE INDEX `attendance_punches_organization_id_employee_id_punched_at_key`(`organization_id`, `employee_id`, `punched_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `shift_id` CHAR(36) NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_DUTY', 'LOP') NOT NULL,
    `override_status` ENUM('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_DUTY', 'LOP') NULL,
    `override_reason` VARCHAR(1000) NULL,
    `first_in` DATETIME(3) NULL,
    `last_out` DATETIME(3) NULL,
    `worked_minutes` INTEGER NOT NULL DEFAULT 0,
    `late_minutes` INTEGER NOT NULL DEFAULT 0,
    `early_exit_minutes` INTEGER NOT NULL DEFAULT 0,
    `overtime_minutes` INTEGER NOT NULL DEFAULT 0,
    `is_late` BOOLEAN NOT NULL DEFAULT false,
    `missing_punch` BOOLEAN NOT NULL DEFAULT false,
    `present_days` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `paid_leave_days` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `unpaid_leave_days` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `absent_days` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `off_days` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `leave_type_id` CHAR(36) NULL,
    `leave_request_id` CHAR(36) NULL,
    `holiday_name` VARCHAR(200) NULL,
    `computed_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_records_organization_id_institution_id_date_idx`(`organization_id`, `institution_id`, `date`),
    INDEX `attendance_records_organization_id_department_id_date_idx`(`organization_id`, `department_id`, `date`),
    INDEX `attendance_records_organization_id_date_status_idx`(`organization_id`, `date`, `status`),
    UNIQUE INDEX `attendance_records_organization_id_employee_id_date_key`(`organization_id`, `employee_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_regularizations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `in_minute` INTEGER NULL,
    `out_minute` INTEGER NULL,
    `requested_status` ENUM('PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_DUTY', 'LOP') NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_regularizations_organization_id_employee_id_date_idx`(`organization_id`, `employee_id`, `date`),
    INDEX `attendance_regularizations_organization_id_institution_id_st_idx`(`organization_id`, `institution_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_period_locks` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `status` ENUM('LOCKED', 'UNLOCKED') NOT NULL DEFAULT 'LOCKED',
    `reason` VARCHAR(500) NULL,
    `locked_by_user_id` CHAR(36) NULL,
    `locked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unlocked_by_user_id` CHAR(36) NULL,
    `unlocked_at` DATETIME(3) NULL,
    `unlock_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_period_locks_organization_id_institution_id_statu_idx`(`organization_id`, `institution_id`, `status`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_policies` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `late_marks_per_half_day` INTEGER NULL,
    `absent_is_lop` BOOLEAN NOT NULL DEFAULT true,
    `allow_web_punch` BOOLEAN NOT NULL DEFAULT true,
    `allow_mobile_punch` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_policies_organization_id_institution_id_key`(`organization_id`, `institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_import_jobs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `source` ENUM('WEB', 'MOBILE', 'BIOMETRIC', 'API', 'MANUAL') NOT NULL,
    `file_name` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `imported_rows` INTEGER NOT NULL DEFAULT 0,
    `duplicate_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `errors` JSON NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_import_jobs_organization_id_created_at_idx`(`organization_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT true,
    `allow_half_day` BOOLEAN NOT NULL DEFAULT true,
    `genders` JSON NULL,
    `employment_types` JSON NULL,
    `requires_document` BOOLEAN NOT NULL DEFAULT false,
    `document_after_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `sandwich_rule` BOOLEAN NOT NULL DEFAULT false,
    `encashable` BOOLEAN NOT NULL DEFAULT false,
    `max_encash_days` DECIMAL(6, 2) NULL,
    `max_carry_forward` DECIMAL(6, 2) NULL,
    `allow_negative_balance` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leave_types_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policies` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `institution_id` CHAR(36) NULL,
    `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING') NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_policies_organization_id_institution_id_employment_typ_idx`(`organization_id`, `institution_id`, `employment_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policy_rules` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `policy_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `accrual_frequency` ENUM('NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY') NOT NULL,
    `annual_quota` DECIMAL(6, 2) NOT NULL,
    `pro_rata_on_joining` BOOLEAN NOT NULL DEFAULT true,
    `max_carry_forward` DECIMAL(6, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_policy_rules_organization_id_leave_type_id_idx`(`organization_id`, `leave_type_id`),
    UNIQUE INDEX `leave_policy_rules_policy_id_leave_type_id_key`(`policy_id`, `leave_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_ledger_entries` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `entry_type` ENUM('ACCRUAL', 'CONSUMPTION', 'ADJUSTMENT', 'CARRY_FORWARD', 'LAPSE', 'ENCASHMENT', 'REVERSAL') NOT NULL,
    `days` DECIMAL(7, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `period_key` VARCHAR(32) NULL,
    `leave_request_id` CHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_ledger_entries_organization_id_employee_id_leave_type__idx`(`organization_id`, `employee_id`, `leave_type_id`, `effective_date`),
    INDEX `leave_ledger_entries_organization_id_leave_request_id_idx`(`organization_id`, `leave_request_id`),
    UNIQUE INDEX `leave_ledger_entries_organization_id_employee_id_leave_type__key`(`organization_id`, `employee_id`, `leave_type_id`, `entry_type`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `start_half` BOOLEAN NOT NULL DEFAULT false,
    `end_half` BOOLEAN NOT NULL DEFAULT false,
    `days` DECIMAL(6, 2) NOT NULL,
    `breakdown` JSON NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `document_id` CHAR(36) NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `workflow_instance_id` CHAR(36) NULL,
    `applied_by_user_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `cancel_reason` VARCHAR(1000) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_requests_organization_id_employee_id_from_date_to_date_idx`(`organization_id`, `employee_id`, `from_date`, `to_date`),
    INDEX `leave_requests_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `holiday_calendars` ADD CONSTRAINT `holiday_calendars_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holiday_calendars` ADD CONSTRAINT `holiday_calendars_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_calendar_id_fkey` FOREIGN KEY (`calendar_id`) REFERENCES `holiday_calendars`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_shift_id_fkey` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_punches` ADD CONSTRAINT `attendance_punches_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_punches` ADD CONSTRAINT `attendance_punches_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_regularizations` ADD CONSTRAINT `attendance_regularizations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_regularizations` ADD CONSTRAINT `attendance_regularizations_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_period_locks` ADD CONSTRAINT `attendance_period_locks_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_period_locks` ADD CONSTRAINT `attendance_period_locks_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_policies` ADD CONSTRAINT `attendance_policies_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_policies` ADD CONSTRAINT `attendance_policies_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_import_jobs` ADD CONSTRAINT `attendance_import_jobs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policy_rules` ADD CONSTRAINT `leave_policy_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policy_rules` ADD CONSTRAINT `leave_policy_rules_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `leave_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_policy_rules` ADD CONSTRAINT `leave_policy_rules_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger_entries` ADD CONSTRAINT `leave_ledger_entries_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger_entries` ADD CONSTRAINT `leave_ledger_entries_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_ledger_entries` ADD CONSTRAINT `leave_ledger_entries_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
