-- Leave policy rules: group-scoped policies, per policy-rule sandwich / notice / limit overrides,
-- and the HR override reason on leave requests. Additive only.

-- AlterTable
ALTER TABLE `leave_policies` ADD COLUMN `group_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `leave_policy_rules`
    ADD COLUMN `sandwich_mode` VARCHAR(16) NULL,
    ADD COLUMN `sandwich_min_days` DECIMAL(6, 2) NULL,
    ADD COLUMN `sandwich_adjacent` BOOLEAN NULL,
    ADD COLUMN `min_notice_days` INTEGER NULL,
    ADD COLUMN `notice_tiers` JSON NULL,
    ADD COLUMN `max_advance_days` INTEGER NULL,
    ADD COLUMN `allow_backdated` BOOLEAN NULL,
    ADD COLUMN `backdated_max_days` INTEGER NULL,
    ADD COLUMN `min_days_per_request` DECIMAL(6, 2) NULL,
    ADD COLUMN `max_consecutive_days` DECIMAL(6, 2) NULL,
    ADD COLUMN `max_requests_per_month` INTEGER NULL,
    ADD COLUMN `max_days_per_month` DECIMAL(6, 2) NULL,
    ADD COLUMN `not_clubbable_with` JSON NULL;

-- AlterTable
ALTER TABLE `leave_requests` ADD COLUMN `rule_override_reason` VARCHAR(500) NULL;

-- CreateIndex
CREATE INDEX `leave_policies_organization_id_group_id_idx` ON `leave_policies`(`organization_id`, `group_id`);

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
