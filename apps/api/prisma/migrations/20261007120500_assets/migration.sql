-- CreateTable
CREATE TABLE `asset_categories` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `attributes` JSON NULL,
    `depreciation_method` ENUM('NONE', 'SLM', 'WDV') NOT NULL DEFAULT 'SLM',
    `depreciation_rate` DECIMAL(6, 2) NULL,
    `useful_life_years` INTEGER NULL,
    `residual_percent` DECIMAL(5, 2) NOT NULL DEFAULT 5,
    `tag_prefix` VARCHAR(24) NOT NULL,
    `tag_padding` INTEGER NOT NULL DEFAULT 5,
    `tag_next_number` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `asset_categories_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `asset_categories_organization_id_kind_idx`(`organization_id`, `kind`),
    INDEX `asset_categories_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `asset_categories_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `category_id` CHAR(36) NOT NULL,
    `asset_tag` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `make` VARCHAR(120) NULL,
    `model` VARCHAR(120) NULL,
    `serial_no` VARCHAR(120) NULL,
    `attributes` JSON NULL,
    `vendor` VARCHAR(200) NULL,
    `invoice_no` VARCHAR(80) NULL,
    `purchase_date` DATE NULL,
    `purchase_cost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `warranty_expiry` DATE NULL,
    `invoice_document_id` CHAR(36) NULL,
    `amc_vendor` VARCHAR(200) NULL,
    `amc_expiry` DATE NULL,
    `service_interval_days` INTEGER NULL,
    `next_service_date` DATE NULL,
    `location` VARCHAR(200) NULL,
    `condition` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NOT NULL DEFAULT 'GOOD',
    `status` ENUM('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'DISPOSED') NOT NULL DEFAULT 'IN_STOCK',
    `custodian_employee_id` CHAR(36) NULL,
    `last_verified_at` DATETIME(3) NULL,
    `disposed_at` DATE NULL,
    `notes` VARCHAR(2000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `assets_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `assets_organization_id_group_id_idx`(`organization_id`, `group_id`),
    INDEX `assets_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `assets_organization_id_category_id_idx`(`organization_id`, `category_id`),
    INDEX `assets_organization_id_custodian_employee_id_idx`(`organization_id`, `custodian_employee_id`),
    INDEX `assets_organization_id_serial_no_idx`(`organization_id`, `serial_no`),
    INDEX `assets_organization_id_warranty_expiry_idx`(`organization_id`, `warranty_expiry`),
    INDEX `assets_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `assets_organization_id_asset_tag_key`(`organization_id`, `asset_tag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_assignments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `target_type` ENUM('EMPLOYEE', 'DEPARTMENT', 'LOCATION') NOT NULL DEFAULT 'EMPLOYEE',
    `employee_id` CHAR(36) NULL,
    `assigned_department_id` CHAR(36) NULL,
    `location` VARCHAR(200) NULL,
    `assigned_at` DATE NOT NULL,
    `expected_return_date` DATE NULL,
    `accessories` JSON NULL,
    `condition_out` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NOT NULL DEFAULT 'GOOD',
    `notes` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'RETURNED') NOT NULL DEFAULT 'ACTIVE',
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_user_id` CHAR(36) NULL,
    `acknowledgement_note` VARCHAR(1000) NULL,
    `handover_document_id` CHAR(36) NULL,
    `assigned_by_user_id` CHAR(36) NULL,
    `returned_at` DATE NULL,
    `return_status` ENUM('RETURNED', 'DAMAGED', 'MISSING') NULL,
    `condition_in` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NULL,
    `recovery_amount` DECIMAL(14, 2) NULL,
    `return_notes` VARCHAR(1000) NULL,
    `returned_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_assignments_organization_id_asset_id_status_idx`(`organization_id`, `asset_id`, `status`),
    INDEX `asset_assignments_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    INDEX `asset_assignments_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `asset_assignments_organization_id_status_assigned_at_idx`(`organization_id`, `status`, `assigned_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_transfers` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `to_group_id` CHAR(36) NULL,
    `to_institution_id` CHAR(36) NOT NULL,
    `to_campus_id` CHAR(36) NULL,
    `to_department_id` CHAR(36) NULL,
    `from_location` VARCHAR(200) NULL,
    `to_location` VARCHAR(200) NULL,
    `reason` VARCHAR(1000) NULL,
    `status` ENUM('PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_comment` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_transfers_organization_id_asset_id_idx`(`organization_id`, `asset_id`),
    INDEX `asset_transfers_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `asset_transfers_organization_id_to_institution_id_status_idx`(`organization_id`, `to_institution_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_maintenance` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `ticket_no` VARCHAR(40) NOT NULL,
    `type` ENUM('REPAIR', 'PREVENTIVE', 'AMC_VISIT', 'WARRANTY_CLAIM', 'INSPECTION') NOT NULL DEFAULT 'REPAIR',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `vendor` VARCHAR(200) NULL,
    `scheduled_date` DATE NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATE NULL,
    `cost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `under_warranty` BOOLEAN NOT NULL DEFAULT false,
    `resolution` VARCHAR(2000) NULL,
    `next_service_date` DATE NULL,
    `status_before` ENUM('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'DISPOSED') NULL,
    `reported_by_user_id` CHAR(36) NULL,
    `reported_by_employee_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_maintenance_organization_id_asset_id_idx`(`organization_id`, `asset_id`),
    INDEX `asset_maintenance_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `asset_maintenance_organization_id_status_scheduled_date_idx`(`organization_id`, `status`, `scheduled_date`),
    UNIQUE INDEX `asset_maintenance_organization_id_ticket_no_key`(`organization_id`, `ticket_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_disposals` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `method` ENUM('SOLD', 'SCRAPPED', 'DONATED', 'WRITTEN_OFF', 'LOST') NOT NULL,
    `disposal_date` DATE NOT NULL,
    `book_value` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `sale_value` DECIMAL(14, 2) NULL,
    `buyer` VARCHAR(200) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `status_before` ENUM('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'LOST', 'DISPOSED') NOT NULL,
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_comment` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_disposals_organization_id_asset_id_idx`(`organization_id`, `asset_id`),
    INDEX `asset_disposals_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_audits` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `category_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` ENUM('OPEN', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `notes` VARCHAR(2000) NULL,
    `started_by_user_id` CHAR(36) NULL,
    `completed_by_user_id` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `asset_audits_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `asset_audits_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_audit_items` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `audit_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `expected_location` VARCHAR(200) NULL,
    `expected_condition` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NULL,
    `result` ENUM('PENDING', 'VERIFIED', 'MISSING', 'LOCATION_MISMATCH', 'CONDITION_MISMATCH') NOT NULL DEFAULT 'PENDING',
    `observed_location` VARCHAR(200) NULL,
    `observed_condition` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NULL,
    `notes` VARCHAR(1000) NULL,
    `verified_at` DATETIME(3) NULL,
    `verified_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_audit_items_organization_id_audit_id_result_idx`(`organization_id`, `audit_id`, `result`),
    INDEX `asset_audit_items_organization_id_asset_id_idx`(`organization_id`, `asset_id`),
    UNIQUE INDEX `asset_audit_items_audit_id_asset_id_key`(`audit_id`, `asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_items` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `sku` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(80) NULL,
    `unit` VARCHAR(24) NOT NULL DEFAULT 'pcs',
    `quantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `reorder_level` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `unit_cost` DECIMAL(14, 2) NULL,
    `location` VARCHAR(200) NULL,
    `notes` VARCHAR(1000) NULL,
    `last_alert_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_items_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `inventory_items_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `inventory_items_organization_id_institution_id_sku_key`(`organization_id`, `institution_id`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_transactions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `type` ENUM('IN', 'OUT', 'ADJUST') NOT NULL,
    `quantity` DECIMAL(14, 2) NOT NULL,
    `balance_after` DECIMAL(14, 2) NOT NULL,
    `unit_cost` DECIMAL(14, 2) NULL,
    `date` DATE NOT NULL,
    `reference` VARCHAR(120) NULL,
    `issued_to_employee_id` CHAR(36) NULL,
    `notes` VARCHAR(1000) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_transactions_organization_id_item_id_date_idx`(`organization_id`, `item_id`, `date`),
    INDEX `inventory_transactions_organization_id_institution_id_date_idx`(`organization_id`, `institution_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asset_categories` ADD CONSTRAINT `asset_categories_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_categories` ADD CONSTRAINT `asset_categories_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_categories` ADD CONSTRAINT `asset_categories_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `asset_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_custodian_employee_id_fkey` FOREIGN KEY (`custodian_employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_assignments` ADD CONSTRAINT `asset_assignments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_assignments` ADD CONSTRAINT `asset_assignments_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_assignments` ADD CONSTRAINT `asset_assignments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_transfers` ADD CONSTRAINT `asset_transfers_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_transfers` ADD CONSTRAINT `asset_transfers_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_disposals` ADD CONSTRAINT `asset_disposals_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_disposals` ADD CONSTRAINT `asset_disposals_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_audits` ADD CONSTRAINT `asset_audits_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_audits` ADD CONSTRAINT `asset_audits_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_audit_items` ADD CONSTRAINT `asset_audit_items_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_audit_items` ADD CONSTRAINT `asset_audit_items_audit_id_fkey` FOREIGN KEY (`audit_id`) REFERENCES `asset_audits`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_audit_items` ADD CONSTRAINT `asset_audit_items_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

