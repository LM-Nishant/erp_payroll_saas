-- AlterTable
ALTER TABLE `designations` ADD COLUMN `department_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `designations_organization_id_department_id_idx` ON `designations`(`organization_id`, `department_id`);

-- AddForeignKey
ALTER TABLE `designations` ADD CONSTRAINT `designations_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
