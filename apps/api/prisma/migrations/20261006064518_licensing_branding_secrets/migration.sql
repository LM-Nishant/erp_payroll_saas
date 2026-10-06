-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `price_cents` INTEGER NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'INR',
    `billing_interval` ENUM('MONTHLY', 'YEARLY') NOT NULL DEFAULT 'MONTHLY',
    `trial_days` INTEGER NOT NULL DEFAULT 14,
    `features` JSON NOT NULL,
    `limits` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_plans_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED') NOT NULL DEFAULT 'TRIAL',
    `trial_ends_at` DATETIME(3) NULL,
    `current_period_start` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `current_period_end` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `add_on_features` JSON NOT NULL,
    `limit_overrides` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `organization_subscriptions_organization_id_key`(`organization_id`),
    INDEX `organization_subscriptions_plan_id_idx`(`plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `status` ENUM('DRAFT', 'OPEN', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'OPEN',
    `issued_at` DATETIME(3) NULL,
    `due_at` DATETIME(3) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `payment_method` VARCHAR(64) NULL,
    `payment_reference` VARCHAR(128) NULL,
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_organization_id_status_idx`(`organization_id`, `status`),
    INDEX `invoices_subscription_id_idx`(`subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_overrides` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `feature_key` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `feature_overrides_group_id_idx`(`group_id`),
    INDEX `feature_overrides_institution_id_idx`(`institution_id`),
    UNIQUE INDEX `feature_overrides_organization_id_scope_type_target_id_featu_key`(`organization_id`, `scope_type`, `target_id`, `feature_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_counters` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `limit_key` VARCHAR(64) NOT NULL,
    `period_key` VARCHAR(16) NOT NULL,
    `used` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usage_counters_organization_id_limit_key_period_key_key`(`organization_id`, `limit_key`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branding_profiles` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `display_name` VARCHAR(200) NULL,
    `short_name` VARCHAR(50) NULL,
    `logo_storage_key` VARCHAR(512) NULL,
    `logo_file_id` CHAR(36) NULL,
    `primary_color` CHAR(7) NULL,
    `secondary_color` CHAR(7) NULL,
    `accent_color` CHAR(7) NULL,
    `letterhead_text` TEXT NULL,
    `footer_text` VARCHAR(1000) NULL,
    `address` VARCHAR(500) NULL,
    `contact_email` VARCHAR(200) NULL,
    `contact_phone` VARCHAR(32) NULL,
    `website` VARCHAR(300) NULL,
    `custom_domain` VARCHAR(253) NULL,
    `subdomain` VARCHAR(63) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `branding_profiles_custom_domain_key`(`custom_domain`),
    UNIQUE INDEX `branding_profiles_subdomain_key`(`subdomain`),
    INDEX `branding_profiles_group_id_idx`(`group_id`),
    INDEX `branding_profiles_institution_id_idx`(`institution_id`),
    UNIQUE INDEX `branding_profiles_organization_id_scope_type_target_id_key`(`organization_id`, `scope_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_secrets` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `kind` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `ciphertext` TEXT NOT NULL,
    `wrapped_key` VARCHAR(512) NOT NULL,
    `key_provider` VARCHAR(32) NOT NULL,
    `key_version` INTEGER NOT NULL,
    `last4` VARCHAR(4) NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` CHAR(36) NULL,
    `updated_by_id` CHAR(36) NULL,
    `rotated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tenant_secrets_organization_id_kind_idx`(`organization_id`, `kind`),
    INDEX `tenant_secrets_group_id_idx`(`group_id`),
    INDEX `tenant_secrets_institution_id_idx`(`institution_id`),
    INDEX `tenant_secrets_key_version_idx`(`key_version`),
    UNIQUE INDEX `tenant_secrets_organization_id_scope_type_target_id_kind_nam_key`(`organization_id`, `scope_type`, `target_id`, `kind`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organization_subscriptions` ADD CONSTRAINT `organization_subscriptions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_subscriptions` ADD CONSTRAINT `organization_subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `organization_subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_overrides` ADD CONSTRAINT `feature_overrides_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_overrides` ADD CONSTRAINT `feature_overrides_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_overrides` ADD CONSTRAINT `feature_overrides_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usage_counters` ADD CONSTRAINT `usage_counters_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branding_profiles` ADD CONSTRAINT `branding_profiles_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branding_profiles` ADD CONSTRAINT `branding_profiles_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branding_profiles` ADD CONSTRAINT `branding_profiles_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_secrets` ADD CONSTRAINT `tenant_secrets_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_secrets` ADD CONSTRAINT `tenant_secrets_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_secrets` ADD CONSTRAINT `tenant_secrets_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
