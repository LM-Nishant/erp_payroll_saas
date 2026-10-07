-- CreateTable
CREATE TABLE `salary_components` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `calc_type` VARCHAR(16) NOT NULL,
    `amount` DECIMAL(14, 2) NULL,
    `percentage` DECIMAL(9, 4) NULL,
    `percent_of` VARCHAR(32) NULL,
    `formula` TEXT NULL,
    `slab_basis` VARCHAR(32) NULL,
    `slabs` JSON NULL,
    `statutory_code` VARCHAR(16) NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `pro_rated` BOOLEAN NOT NULL DEFAULT true,
    `rounding` VARCHAR(16) NOT NULL DEFAULT 'NEAREST',
    `rounding_precision` INTEGER NOT NULL DEFAULT 0,
    `display_order` INTEGER NOT NULL DEFAULT 100,
    `show_on_payslip` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(500) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `salary_components_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `salary_components_organization_id_scope_key_code_key`(`organization_id`, `scope_key`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_rules` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `component_code` VARCHAR(32) NOT NULL,
    `effective_from` DATE NOT NULL,
    `version` INTEGER NOT NULL,
    `calc_type` VARCHAR(16) NOT NULL,
    `amount` DECIMAL(14, 2) NULL,
    `percentage` DECIMAL(9, 4) NULL,
    `percent_of` VARCHAR(32) NULL,
    `formula` TEXT NULL,
    `slab_basis` VARCHAR(32) NULL,
    `slabs` JSON NULL,
    `condition` TEXT NULL,
    `notes` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_rules_organization_id_scope_key_component_code_effect_idx`(`organization_id`, `scope_key`, `component_code`, `effective_from`),
    UNIQUE INDEX `salary_rules_organization_id_scope_key_component_code_versio_key`(`organization_id`, `scope_key`, `component_code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structures` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `employment_type` VARCHAR(32) NULL,
    `grade` VARCHAR(64) NULL,
    `description` VARCHAR(500) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `salary_structures_organization_id_institution_id_code_key`(`organization_id`, `institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structure_versions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `effective_from` DATE NOT NULL,
    `lines` JSON NOT NULL,
    `notes` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_structure_versions_organization_id_structure_id_idx`(`organization_id`, `structure_id`),
    UNIQUE INDEX `salary_structure_versions_structure_id_version_key`(`structure_id`, `version`),
    UNIQUE INDEX `salary_structure_versions_structure_id_effective_from_key`(`structure_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_settings` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `state` VARCHAR(8) NULL,
    `pf_enabled` BOOLEAN NOT NULL DEFAULT true,
    `esi_enabled` BOOLEAN NOT NULL DEFAULT true,
    `pt_enabled` BOOLEAN NOT NULL DEFAULT true,
    `tds_enabled` BOOLEAN NOT NULL DEFAULT true,
    `lwf_enabled` BOOLEAN NOT NULL DEFAULT false,
    `require_attendance_lock` BOOLEAN NOT NULL DEFAULT true,
    `pay_day` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_settings_organization_id_institution_id_key`(`organization_id`, `institution_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_rule_packs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `pack` VARCHAR(8) NOT NULL,
    `financial_year` VARCHAR(7) NOT NULL,
    `region` VARCHAR(8) NOT NULL DEFAULT 'IN',
    `version` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `notes` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `statutory_rule_packs_organization_id_pack_financial_year_reg_key`(`organization_id`, `pack`, `financial_year`, `region`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_salaries` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `salary_history_id` CHAR(36) NOT NULL,
    `effective_from` DATE NOT NULL,
    `annual_ctc` DECIMAL(14, 2) NOT NULL,
    `amounts` JSON NOT NULL,
    `tax_regime` VARCHAR(8) NOT NULL DEFAULT 'NEW',
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `employee_salaries_salary_history_id_key`(`salary_history_id`),
    INDEX `employee_salaries_organization_id_employee_id_effective_from_idx`(`organization_id`, `employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_revisions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `structure_id` CHAR(36) NULL,
    `effective_from` DATE NOT NULL,
    `annual_ctc` DECIMAL(14, 2) NOT NULL,
    `previous_annual_ctc` DECIMAL(14, 2) NULL,
    `amounts` JSON NOT NULL,
    `tax_regime` VARCHAR(8) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `workflow_instance_id` CHAR(36) NULL,
    `salary_history_id` CHAR(36) NULL,
    `arrears_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `arrears` JSON NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `salary_revisions_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_batches` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_batches_organization_id_group_id_period_start_idx`(`organization_id`, `group_id`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `batch_id` CHAR(36) NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `previous_run_id` CHAR(36) NULL,
    `attendance_locked` BOOLEAN NOT NULL DEFAULT false,
    `employee_count` INTEGER NOT NULL DEFAULT 0,
    `error_count` INTEGER NOT NULL DEFAULT 0,
    `gross_total` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `deduction_total` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `net_total` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `employer_total` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    `pending_batches` INTEGER NOT NULL DEFAULT 0,
    `compute_token` CHAR(36) NULL,
    `workflow_instance_id` CHAR(36) NULL,
    `computed_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `finalized_at` DATETIME(3) NULL,
    `finalized_by_user_id` CHAR(36) NULL,
    `reopened_at` DATETIME(3) NULL,
    `reopen_reason` VARCHAR(500) NULL,
    `reopened_by_user_id` CHAR(36) NULL,
    `payslips_published_at` DATETIME(3) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_runs_organization_id_institution_id_period_start_sta_idx`(`organization_id`, `institution_id`, `period_start`, `status`),
    INDEX `payroll_runs_organization_id_batch_id_idx`(`organization_id`, `batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run_employees` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `employee_code` VARCHAR(64) NOT NULL,
    `employee_name` VARCHAR(200) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OK',
    `error` TEXT NULL,
    `calendar_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `payable_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `lop_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `institution_days` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `factor` DECIMAL(10, 6) NOT NULL DEFAULT 0,
    `gross` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `deductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `employer_contributions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `salary_history_id` CHAR(36) NULL,
    `structure_version_id` CHAR(36) NULL,
    `trace` JSON NOT NULL,
    `warnings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_run_employees_organization_id_employee_id_idx`(`organization_id`, `employee_id`),
    UNIQUE INDEX `payroll_run_employees_run_id_employee_id_key`(`run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_items` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `statutory_code` VARCHAR(16) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `full_amount` DECIMAL(14, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `show_on_payslip` BOOLEAN NOT NULL DEFAULT true,
    `display_order` INTEGER NOT NULL DEFAULT 100,
    `explanation` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_items_organization_id_run_id_employee_id_idx`(`organization_id`, `run_id`, `employee_id`),
    INDEX `payroll_items_organization_id_run_id_code_idx`(`organization_id`, `run_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_adjustments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(300) NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'manual',
    `source_id` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_adjustments_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `payroll_adjustments_organization_id_run_id_idx`(`organization_id`, `run_id`),
    INDEX `payroll_adjustments_organization_id_employee_id_idx`(`organization_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_payments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `method` VARCHAR(24) NOT NULL DEFAULT 'BANK_TRANSFER',
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `bank_account_masked` VARCHAR(32) NULL,
    `reference` VARCHAR(120) NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_payments_organization_id_run_id_status_idx`(`organization_id`, `run_id`, `status`),
    UNIQUE INDEX `payroll_payments_run_id_employee_id_key`(`run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `document_id` CHAR(36) NULL,
    `net` DECIMAL(14, 2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payslips_organization_id_employee_id_period_start_idx`(`organization_id`, `employee_id`, `period_start`),
    UNIQUE INDEX `payslips_run_id_employee_id_key`(`run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `form16_records` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `financial_year` VARCHAR(7) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `published_by_user_id` CHAR(36) NULL,
    `uploaded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `form16_records_organization_id_employee_id_financial_year_key`(`organization_id`, `employee_id`, `financial_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loans` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `loan_type` VARCHAR(64) NOT NULL,
    `principal` DECIMAL(14, 2) NOT NULL,
    `emi_amount` DECIMAL(14, 2) NOT NULL,
    `outstanding` DECIMAL(14, 2) NOT NULL,
    `start_month` DATE NOT NULL,
    `tenure_months` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `loans_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loan_installments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `loan_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `due_month` DATE NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DUE',
    `run_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `loan_installments_organization_id_employee_id_due_month_stat_idx`(`organization_id`, `employee_id`, `due_month`, `status`),
    UNIQUE INDEX `loan_installments_loan_id_due_month_key`(`loan_id`, `due_month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reimbursement_claims` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `category` VARCHAR(64) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `claim_date` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `workflow_instance_id` CHAR(36) NULL,
    `adjustment_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reimbursement_claims_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `salary_components` ADD CONSTRAINT `salary_components_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_rules` ADD CONSTRAINT `salary_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structures` ADD CONSTRAINT `salary_structures_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structure_versions` ADD CONSTRAINT `salary_structure_versions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structure_versions` ADD CONSTRAINT `salary_structure_versions_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `salary_structures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `statutory_rule_packs` ADD CONSTRAINT `statutory_rule_packs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_salaries` ADD CONSTRAINT `employee_salaries_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_revisions` ADD CONSTRAINT `salary_revisions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_batches` ADD CONSTRAINT `payroll_batches_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `payroll_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_payments` ADD CONSTRAINT `payroll_payments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `form16_records` ADD CONSTRAINT `form16_records_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_installments` ADD CONSTRAINT `loan_installments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loan_installments` ADD CONSTRAINT `loan_installments_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reimbursement_claims` ADD CONSTRAINT `reimbursement_claims_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------------------
-- Payroll immutability (acceptance 14-15): once a run is submitted / approved / finalized its
-- computed lines can no longer change. Any correction requires an explicit, audited reopen that
-- creates a NEW run revision; the reopened run itself becomes read-only.
-- ------------------------------------------------------------------------------------------

CREATE TRIGGER `payroll_runs_guard_update` BEFORE UPDATE ON `payroll_runs`
FOR EACH ROW
BEGIN
  IF OLD.`status` IN ('REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is closed (reopened / cancelled) and immutable';
  END IF;
  IF OLD.`status` IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED') AND (
       NEW.`institution_id` <> OLD.`institution_id`
    OR NEW.`period_start` <> OLD.`period_start`
    OR NEW.`period_end` <> OLD.`period_end`
    OR NEW.`revision` <> OLD.`revision`
    OR NEW.`gross_total` <> OLD.`gross_total`
    OR NEW.`deduction_total` <> OLD.`deduction_total`
    OR NEW.`net_total` <> OLD.`net_total`
    OR NEW.`employer_total` <> OLD.`employer_total`
    OR NEW.`employee_count` <> OLD.`employee_count`
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run figures are locked once submitted';
  END IF;
  IF OLD.`status` = 'FINALIZED' AND NEW.`status` NOT IN ('FINALIZED', 'REOPENED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finalized payroll can only be reopened';
  END IF;
  IF OLD.`status` = 'APPROVED' AND NEW.`status` NOT IN ('APPROVED', 'FINALIZED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approved payroll can only be finalized';
  END IF;
END;

CREATE TRIGGER `payroll_runs_guard_delete` BEFORE DELETE ON `payroll_runs`
FOR EACH ROW
BEGIN
  IF OLD.`status` IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'submitted / finalized payroll runs cannot be deleted';
  END IF;
END;

CREATE TRIGGER `payroll_items_guard_insert` BEFORE INSERT ON `payroll_items`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_items_guard_update` BEFORE UPDATE ON `payroll_items`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_items_guard_delete` BEFORE DELETE ON `payroll_items`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_run_employees_guard_insert` BEFORE INSERT ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_run_employees_guard_update` BEFORE UPDATE ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_run_employees_guard_delete` BEFORE DELETE ON `payroll_run_employees`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_adjustments_guard_insert` BEFORE INSERT ON `payroll_adjustments`
FOR EACH ROW
BEGIN
  IF NEW.`run_id` IS NOT NULL AND (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_adjustments_guard_update` BEFORE UPDATE ON `payroll_adjustments`
FOR EACH ROW
BEGIN
  IF OLD.`run_id` IS NOT NULL AND (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
  IF NEW.`run_id` IS NOT NULL AND (SELECT `status` FROM `payroll_runs` WHERE `id` = NEW.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_adjustments_guard_delete` BEFORE DELETE ON `payroll_adjustments`
FOR EACH ROW
BEGIN
  IF OLD.`run_id` IS NOT NULL AND (SELECT `status` FROM `payroll_runs` WHERE `id` = OLD.`run_id`) IN ('PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'REOPENED', 'CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll run is locked';
  END IF;
END;

CREATE TRIGGER `payroll_payments_guard_update` BEFORE UPDATE ON `payroll_payments`
FOR EACH ROW
BEGIN
  IF NEW.`amount` <> OLD.`amount` OR NEW.`run_id` <> OLD.`run_id` OR NEW.`employee_id` <> OLD.`employee_id` THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll payment amount is immutable';
  END IF;
END;

CREATE TRIGGER `payroll_payments_no_delete` BEFORE DELETE ON `payroll_payments`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payroll payments cannot be deleted';

CREATE TRIGGER `salary_structure_versions_no_update` BEFORE UPDATE ON `salary_structure_versions`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'salary structure versions are immutable';

CREATE TRIGGER `salary_rules_no_update` BEFORE UPDATE ON `salary_rules`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'salary rules are immutable; create a new version';
