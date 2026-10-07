-- CreateTable
CREATE TABLE `ai_settings` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `provider` VARCHAR(16) NOT NULL DEFAULT 'mock',
    `default_model` VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
    `max_tokens_per_request` INTEGER NOT NULL DEFAULT 1024,
    `temperature` DECIMAL(3, 2) NOT NULL DEFAULT 0.2,
    `enabled_features` JSON NOT NULL,
    `data_sharing` BOOLEAN NOT NULL DEFAULT false,
    `updated_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_settings_organization_id_key`(`organization_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `feature` VARCHAR(32) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `message_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `ai_conversations_organization_id_user_id_deleted_at_updated__idx`(`organization_id`, `user_id`, `deleted_at`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `tool_calls` JSON NULL,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_messages_organization_id_conversation_id_created_at_idx`(`organization_id`, `conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_usage_logs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `feature` VARCHAR(32) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `prompt_tokens` INTEGER NOT NULL DEFAULT 0,
    `completion_tokens` INTEGER NOT NULL DEFAULT 0,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `latency_ms` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `prompt_redacted` VARCHAR(1000) NULL,
    `conversation_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_usage_logs_organization_id_created_at_idx`(`organization_id`, `created_at`),
    INDEX `ai_usage_logs_organization_id_feature_created_at_idx`(`organization_id`, `feature`, `created_at`),
    INDEX `ai_usage_logs_organization_id_user_id_created_at_idx`(`organization_id`, `user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_settings` ADD CONSTRAINT `ai_settings_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_usage_logs` ADD CONSTRAINT `ai_usage_logs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

