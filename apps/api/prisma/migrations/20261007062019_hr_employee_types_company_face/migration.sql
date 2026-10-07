-- AlterTable
ALTER TABLE `attendance_policies` ADD COLUMN `require_face_match` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `attendance_punches` ADD COLUMN `face_distance` DECIMAL(6, 4) NULL,
    ADD COLUMN `selfie_document_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `designations` MODIFY `category` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING', 'FULL_TIME', 'PART_TIME', 'INTERN') NULL;

-- AlterTable
ALTER TABLE `employee_positions` MODIFY `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING', 'FULL_TIME', 'PART_TIME', 'INTERN') NOT NULL;

-- AlterTable
ALTER TABLE `employees` ADD COLUMN `employee_type_id` CHAR(36) NULL,
    ADD COLUMN `face_descriptor` JSON NULL,
    ADD COLUMN `photo_document_id` CHAR(36) NULL,
    MODIFY `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING', 'FULL_TIME', 'PART_TIME', 'INTERN') NOT NULL;

-- AlterTable
ALTER TABLE `leave_policies` MODIFY `employment_type` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING', 'FULL_TIME', 'PART_TIME', 'INTERN') NULL;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `kind` ENUM('EDUCATION', 'COMPANY') NOT NULL DEFAULT 'EDUCATION';

-- CreateTable
CREATE TABLE `employee_types` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` ENUM('TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING', 'FULL_TIME', 'PART_TIME', 'INTERN') NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_types_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `employee_types_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `employees_organization_id_employee_type_id_idx` ON `employees`(`organization_id`, `employee_type_id`);

-- AddForeignKey
ALTER TABLE `employee_types` ADD CONSTRAINT `employee_types_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_employee_type_id_fkey` FOREIGN KEY (`employee_type_id`) REFERENCES `employee_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
