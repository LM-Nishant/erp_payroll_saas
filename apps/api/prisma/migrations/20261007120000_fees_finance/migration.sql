-- CreateTable
CREATE TABLE `fee_heads` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(24) NOT NULL DEFAULT 'MISC',
    `refundable` BOOLEAN NOT NULL DEFAULT false,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `income_account_id` CHAR(36) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_heads_organization_id_institution_id_deleted_at_idx`(`organization_id`, `institution_id`, `deleted_at`),
    UNIQUE INDEX `fee_heads_organization_id_institution_id_code_key`(`organization_id`, `institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_late_rules` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'FLAT',
    `amount` DECIMAL(14, 2) NOT NULL,
    `grace_days` INTEGER NOT NULL DEFAULT 0,
    `max_amount` DECIMAL(14, 2) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_late_rules_organization_id_institution_id_deleted_at_idx`(`organization_id`, `institution_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structures` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `program_id` CHAR(36) NULL,
    `class_section_id` CHAR(36) NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `late_rule_id` CHAR(36) NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_structures_organization_id_institution_id_academic_year__idx`(`organization_id`, `institution_id`, `academic_year`, `deleted_at`),
    INDEX `fee_structures_organization_id_class_section_id_idx`(`organization_id`, `class_section_id`),
    INDEX `fee_structures_organization_id_program_id_idx`(`organization_id`, `program_id`),
    UNIQUE INDEX `fee_structures_organization_id_institution_id_academic_year__key`(`organization_id`, `institution_id`, `academic_year`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_installments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `seq` INTEGER NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `due_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_installments_organization_id_structure_id_idx`(`organization_id`, `structure_id`),
    UNIQUE INDEX `fee_installments_structure_id_seq_key`(`structure_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structure_items` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `installment_id` CHAR(36) NOT NULL,
    `fee_head_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_structure_items_organization_id_structure_id_idx`(`organization_id`, `structure_id`),
    UNIQUE INDEX `fee_structure_items_installment_id_fee_head_id_key`(`installment_id`, `fee_head_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_concessions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'CONCESSION',
    `applies_to` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `category` VARCHAR(64) NULL,
    `fee_head_id` CHAR(36) NULL,
    `value_type` VARCHAR(16) NOT NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `academic_year` VARCHAR(9) NULL,
    `reason` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `approved_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_concessions_organization_id_institution_id_applies_to_de_idx`(`organization_id`, `institution_id`, `applies_to`, `deleted_at`),
    INDEX `fee_concessions_organization_id_student_id_idx`(`organization_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_invoices` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `program_id` CHAR(36) NULL,
    `class_section_id` CHAR(36) NULL,
    `student_id` CHAR(36) NOT NULL,
    `academic_year` VARCHAR(9) NULL,
    `number` VARCHAR(40) NOT NULL,
    `structure_id` CHAR(36) NULL,
    `installment_id` CHAR(36) NULL,
    `source_type` VARCHAR(32) NOT NULL DEFAULT 'ADHOC',
    `source_id` VARCHAR(64) NULL,
    `dedupe_key` VARCHAR(191) NULL,
    `description` VARCHAR(500) NULL,
    `issue_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `gross_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `concession_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `late_fee_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'UNPAID',
    `late_rule_id` CHAR(36) NULL,
    `last_reminder_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_invoices_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `fee_invoices_organization_id_institution_id_status_due_date_idx`(`organization_id`, `institution_id`, `status`, `due_date`),
    INDEX `fee_invoices_organization_id_class_section_id_status_idx`(`organization_id`, `class_section_id`, `status`),
    INDEX `fee_invoices_organization_id_source_type_source_id_idx`(`organization_id`, `source_type`, `source_id`),
    UNIQUE INDEX `fee_invoices_organization_id_institution_id_number_key`(`organization_id`, `institution_id`, `number`),
    UNIQUE INDEX `fee_invoices_organization_id_dedupe_key_key`(`organization_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_invoice_lines` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NOT NULL,
    `fee_head_id` CHAR(36) NOT NULL,
    `description` VARCHAR(500) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `concession_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net_amount` DECIMAL(14, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_invoice_lines_organization_id_invoice_id_idx`(`organization_id`, `invoice_id`),
    INDEX `fee_invoice_lines_organization_id_fee_head_id_idx`(`organization_id`, `fee_head_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_payments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `student_id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `paid_on` DATE NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `instrument_date` DATE NULL,
    `bank_name` VARCHAR(120) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `allocated_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `refunded_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    `gateway_order_id` CHAR(36) NULL,
    `voucher_id` CHAR(36) NULL,
    `remarks` VARCHAR(500) NULL,
    `collected_by_user_id` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `cancelled_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_payments_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `fee_payments_organization_id_institution_id_paid_on_idx`(`organization_id`, `institution_id`, `paid_on`),
    UNIQUE INDEX `fee_payments_organization_id_institution_id_number_key`(`organization_id`, `institution_id`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_payment_allocations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_payment_allocations_organization_id_invoice_id_idx`(`organization_id`, `invoice_id`),
    UNIQUE INDEX `fee_payment_allocations_payment_id_invoice_id_key`(`payment_id`, `invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_refunds` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `payment_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `refunded_on` DATE NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `voucher_id` CHAR(36) NULL,
    `refunded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_refunds_organization_id_student_id_idx`(`organization_id`, `student_id`),
    UNIQUE INDEX `fee_refunds_organization_id_institution_id_number_key`(`organization_id`, `institution_id`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `finance_number_series` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `prefix` VARCHAR(24) NOT NULL,
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `padding` INTEGER NOT NULL DEFAULT 5,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `finance_number_series_organization_id_institution_id_kind_key`(`organization_id`, `institution_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_gateway_orders` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `student_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `provider_order_id` VARCHAR(120) NOT NULL,
    `provider_payment_id` VARCHAR(120) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `invoice_ids` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'CREATED',
    `payment_id` CHAR(36) NULL,
    `initiated_by_user_id` CHAR(36) NULL,
    `failure_reason` VARCHAR(500) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payment_gateway_orders_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    UNIQUE INDEX `payment_gateway_orders_provider_provider_order_id_key`(`provider`, `provider_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_accounts` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `parent_id` CHAR(36) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `is_group` BOOLEAN NOT NULL DEFAULT false,
    `system_key` VARCHAR(48) NULL,
    `description` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `ledger_accounts_organization_id_parent_id_idx`(`organization_id`, `parent_id`),
    UNIQUE INDEX `ledger_accounts_organization_id_code_key`(`organization_id`, `code`),
    UNIQUE INDEX `ledger_accounts_organization_id_system_key_key`(`organization_id`, `system_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_vouchers` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `number` VARCHAR(40) NOT NULL,
    `voucher_date` DATE NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'JOURNAL',
    `narration` VARCHAR(1000) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `total_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `source_type` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    `source_id` VARCHAR(64) NULL,
    `source_key` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NULL,
    `posted_by_user_id` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journal_vouchers_organization_id_institution_id_voucher_date_idx`(`organization_id`, `institution_id`, `voucher_date`, `status`),
    INDEX `journal_vouchers_organization_id_source_type_source_id_idx`(`organization_id`, `source_type`, `source_id`),
    UNIQUE INDEX `journal_vouchers_organization_id_institution_id_number_key`(`organization_id`, `institution_id`, `number`),
    UNIQUE INDEX `journal_vouchers_organization_id_source_key_key`(`organization_id`, `source_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `voucher_id` CHAR(36) NOT NULL,
    `account_id` CHAR(36) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `debit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `narration` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `journal_lines_organization_id_account_id_idx`(`organization_id`, `account_id`),
    INDEX `journal_lines_organization_id_voucher_id_idx`(`organization_id`, `voucher_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendors` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `gstin` VARCHAR(20) NULL,
    `phone` VARCHAR(32) NULL,
    `email` VARCHAR(254) NULL,
    `address` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `vendors_organization_id_institution_id_deleted_at_idx`(`organization_id`, `institution_id`, `deleted_at`),
    UNIQUE INDEX `vendors_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `number` VARCHAR(40) NOT NULL,
    `expense_date` DATE NOT NULL,
    `vendor_id` CHAR(36) NULL,
    `expense_account_id` CHAR(36) NOT NULL,
    `payment_account_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `description` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'POSTED',
    `voucher_id` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `expenses_organization_id_institution_id_expense_date_idx`(`organization_id`, `institution_id`, `expense_date`),
    UNIQUE INDEX `expenses_organization_id_institution_id_number_key`(`organization_id`, `institution_id`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fee_heads` ADD CONSTRAINT `fee_heads_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_late_rules` ADD CONSTRAINT `fee_late_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_late_rule_id_fkey` FOREIGN KEY (`late_rule_id`) REFERENCES `fee_late_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_installments` ADD CONSTRAINT `fee_installments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_installments` ADD CONSTRAINT `fee_installments_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `fee_structures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_items` ADD CONSTRAINT `fee_structure_items_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_items` ADD CONSTRAINT `fee_structure_items_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `fee_structures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_items` ADD CONSTRAINT `fee_structure_items_installment_id_fkey` FOREIGN KEY (`installment_id`) REFERENCES `fee_installments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_items` ADD CONSTRAINT `fee_structure_items_fee_head_id_fkey` FOREIGN KEY (`fee_head_id`) REFERENCES `fee_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_fee_head_id_fkey` FOREIGN KEY (`fee_head_id`) REFERENCES `fee_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_invoices` ADD CONSTRAINT `fee_invoices_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_invoice_lines` ADD CONSTRAINT `fee_invoice_lines_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_invoice_lines` ADD CONSTRAINT `fee_invoice_lines_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `fee_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_invoice_lines` ADD CONSTRAINT `fee_invoice_lines_fee_head_id_fkey` FOREIGN KEY (`fee_head_id`) REFERENCES `fee_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_payments` ADD CONSTRAINT `fee_payments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_payment_allocations` ADD CONSTRAINT `fee_payment_allocations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_payment_allocations` ADD CONSTRAINT `fee_payment_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `fee_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_payment_allocations` ADD CONSTRAINT `fee_payment_allocations_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `fee_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_refunds` ADD CONSTRAINT `fee_refunds_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_refunds` ADD CONSTRAINT `fee_refunds_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `fee_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `finance_number_series` ADD CONSTRAINT `finance_number_series_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_gateway_orders` ADD CONSTRAINT `payment_gateway_orders_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `ledger_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_vouchers` ADD CONSTRAINT `journal_vouchers_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_voucher_id_fkey` FOREIGN KEY (`voucher_id`) REFERENCES `journal_vouchers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vendors` ADD CONSTRAINT `vendors_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

