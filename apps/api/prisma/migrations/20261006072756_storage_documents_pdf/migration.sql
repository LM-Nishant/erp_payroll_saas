-- CreateTable
CREATE TABLE `documents` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `owner_type` VARCHAR(50) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `module` VARCHAR(50) NOT NULL DEFAULT 'documents',
    `category` VARCHAR(50) NOT NULL,
    `document_type` VARCHAR(64) NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `confidentiality` ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED') NOT NULL DEFAULT 'INTERNAL',
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `current_version_id` CHAR(36) NULL,
    `issue_date` DATE NULL,
    `expiry_date` DATE NULL,
    `metadata` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `updated_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by_id` CHAR(36) NULL,
    `purge_after` DATETIME(3) NULL,
    `purged_at` DATETIME(3) NULL,

    UNIQUE INDEX `documents_current_version_id_key`(`current_version_id`),
    INDEX `documents_organization_id_owner_type_owner_id_idx`(`organization_id`, `owner_type`, `owner_id`),
    INDEX `documents_organization_id_institution_id_category_idx`(`organization_id`, `institution_id`, `category`),
    INDEX `documents_organization_id_group_id_idx`(`organization_id`, `group_id`),
    INDEX `documents_organization_id_expiry_date_idx`(`organization_id`, `expiry_date`),
    INDEX `documents_organization_id_deleted_at_purge_after_idx`(`organization_id`, `deleted_at`, `purge_after`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_versions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `version_number` INTEGER NOT NULL,
    `storage_key` VARCHAR(512) NOT NULL,
    `storage_backend` VARCHAR(16) NOT NULL DEFAULT 'platform',
    `storage_secret_id` CHAR(36) NULL,
    `storage_version_id` VARCHAR(1024) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `checksum_sha256` CHAR(64) NOT NULL,
    `scan_status` ENUM('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `scanned_at` DATETIME(3) NULL,
    `reason` VARCHAR(500) NULL,
    `uploaded_by_id` CHAR(36) NULL,
    `previous_version_id` CHAR(36) NULL,
    `restored_from_version_id` CHAR(36) NULL,
    `purged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `document_versions_storage_key_key`(`storage_key`),
    INDEX `document_versions_organization_id_document_id_idx`(`organization_id`, `document_id`),
    UNIQUE INDEX `document_versions_document_id_version_number_key`(`document_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_permissions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `grantee_type` ENUM('USER', 'ROLE', 'SCOPE') NOT NULL,
    `user_id` CHAR(36) NULL,
    `role_key` VARCHAR(64) NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION', 'CAMPUS', 'DEPARTMENT') NULL,
    `scope_id` CHAR(36) NULL,
    `can_view` BOOLEAN NOT NULL DEFAULT true,
    `can_download` BOOLEAN NOT NULL DEFAULT false,
    `can_upload_version` BOOLEAN NOT NULL DEFAULT false,
    `can_delete` BOOLEAN NOT NULL DEFAULT false,
    `can_share` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `document_permissions_organization_id_document_id_idx`(`organization_id`, `document_id`),
    INDEX `document_permissions_organization_id_user_id_idx`(`organization_id`, `user_id`),
    INDEX `document_permissions_organization_id_role_key_idx`(`organization_id`, `role_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_expiry_reminders` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `days_before` INTEGER NOT NULL,
    `remind_at` DATE NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `document_expiry_reminders_organization_id_status_remind_at_idx`(`organization_id`, `status`, `remind_at`),
    UNIQUE INDEX `document_expiry_reminders_document_id_days_before_key`(`document_id`, `days_before`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_signatures` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `version_id` CHAR(36) NOT NULL,
    `signer_user_id` CHAR(36) NULL,
    `signer_name` VARCHAR(200) NOT NULL,
    `signer_email` VARCHAR(200) NULL,
    `signer_role` VARCHAR(100) NULL,
    `signing_order` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('PENDING', 'SENT', 'SIGNED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(500) NULL,
    `provider` VARCHAR(50) NULL,
    `provider_ref` VARCHAR(255) NULL,
    `responded_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `document_signatures_organization_id_document_id_idx`(`organization_id`, `document_id`),
    INDEX `document_signatures_organization_id_signer_user_id_status_idx`(`organization_id`, `signer_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `storage_uploads` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `purpose` VARCHAR(32) NOT NULL,
    `document_id` CHAR(36) NULL,
    `storage_key` VARCHAR(512) NOT NULL,
    `storage_backend` VARCHAR(16) NOT NULL DEFAULT 'platform',
    `storage_secret_id` CHAR(36) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `declared_size_bytes` INTEGER NOT NULL,
    `declared_checksum` CHAR(64) NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `storage_uploads_storage_key_key`(`storage_key`),
    INDEX `storage_uploads_organization_id_status_expires_at_idx`(`organization_id`, `status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `branding_profiles_logo_file_id_idx` ON `branding_profiles`(`logo_file_id`);

-- AddForeignKey
ALTER TABLE `branding_profiles` ADD CONSTRAINT `branding_profiles_logo_file_id_fkey` FOREIGN KEY (`logo_file_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `document_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_permissions` ADD CONSTRAINT `document_permissions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_permissions` ADD CONSTRAINT `document_permissions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_expiry_reminders` ADD CONSTRAINT `document_expiry_reminders_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_expiry_reminders` ADD CONSTRAINT `document_expiry_reminders_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_signatures` ADD CONSTRAINT `document_signatures_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_signatures` ADD CONSTRAINT `document_signatures_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_signatures` ADD CONSTRAINT `document_signatures_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `document_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_uploads` ADD CONSTRAINT `storage_uploads_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Document versions are immutable: content columns can never change and rows can never be
-- deleted (retention purges the OBJECT and stamps purged_at). Only scan bookkeeping may change.
CREATE TRIGGER `document_versions_immutable` BEFORE UPDATE ON `document_versions`
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.`id` <=> OLD.`id`
    AND NEW.`organization_id` <=> OLD.`organization_id`
    AND NEW.`document_id` <=> OLD.`document_id`
    AND NEW.`version_number` <=> OLD.`version_number`
    AND NEW.`storage_key` <=> OLD.`storage_key`
    AND NEW.`storage_backend` <=> OLD.`storage_backend`
    AND NEW.`storage_secret_id` <=> OLD.`storage_secret_id`
    AND NEW.`storage_version_id` <=> OLD.`storage_version_id`
    AND NEW.`file_name` <=> OLD.`file_name`
    AND NEW.`mime_type` <=> OLD.`mime_type`
    AND NEW.`size_bytes` <=> OLD.`size_bytes`
    AND NEW.`checksum_sha256` <=> OLD.`checksum_sha256`
    AND NEW.`reason` <=> OLD.`reason`
    AND NEW.`uploaded_by_id` <=> OLD.`uploaded_by_id`
    AND NEW.`previous_version_id` <=> OLD.`previous_version_id`
    AND NEW.`restored_from_version_id` <=> OLD.`restored_from_version_id`
    AND NEW.`created_at` <=> OLD.`created_at`
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'document_versions are immutable';
  END IF;
END;

CREATE TRIGGER `document_versions_no_delete` BEFORE DELETE ON `document_versions`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'document_versions are immutable';
