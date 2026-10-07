-- CreateTable
CREATE TABLE `workflow_definitions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `steps` JSON NOT NULL,
    `allow_self_approval` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_definitions_organization_id_entity_type_status_idx`(`organization_id`, `entity_type`, `status`),
    UNIQUE INDEX `workflow_definitions_organization_id_family_id_version_key`(`organization_id`, `family_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_instances` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `definition_version` INTEGER NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SENT_BACK', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requester_user_id` CHAR(36) NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `context` JSON NOT NULL,
    `current_step_order` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_instances_organization_id_entity_type_entity_id_idx`(`organization_id`, `entity_type`, `entity_id`),
    INDEX `workflow_instances_organization_id_requester_user_id_status_idx`(`organization_id`, `requester_user_id`, `status`),
    INDEX `workflow_instances_organization_id_status_idx`(`organization_id`, `status`),
    INDEX `workflow_instances_definition_id_idx`(`definition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_step_instances` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `instance_id` CHAR(36) NOT NULL,
    `step_key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `order` INTEGER NOT NULL,
    `mode` VARCHAR(8) NOT NULL,
    `status` ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'SENT_BACK', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `config` JSON NOT NULL,
    `due_at` DATETIME(3) NULL,
    `escalated_at` DATETIME(3) NULL,
    `activated_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_step_instances_organization_id_status_due_at_idx`(`organization_id`, `status`, `due_at`),
    UNIQUE INDEX `workflow_step_instances_instance_id_order_key`(`instance_id`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_step_assignees` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `step_instance_id` CHAR(36) NOT NULL,
    `instance_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'DELEGATED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING',
    `delegated_from_user_id` CHAR(36) NULL,
    `escalated` BOOLEAN NOT NULL DEFAULT false,
    `acted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_step_assignees_organization_id_user_id_status_idx`(`organization_id`, `user_id`, `status`),
    INDEX `workflow_step_assignees_instance_id_idx`(`instance_id`),
    UNIQUE INDEX `workflow_step_assignees_step_instance_id_user_id_key`(`step_instance_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_actions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `instance_id` CHAR(36) NOT NULL,
    `step_instance_id` CHAR(36) NULL,
    `step_key` VARCHAR(50) NULL,
    `action` VARCHAR(16) NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `comment` TEXT NULL,
    `delegate_to_user_id` CHAR(36) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_actions_instance_id_created_at_idx`(`instance_id`, `created_at`),
    INDEX `workflow_actions_organization_id_actor_user_id_idx`(`organization_id`, `actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `data` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_organization_id_user_id_read_at_idx`(`organization_id`, `user_id`, `read_at`),
    INDEX `notifications_organization_id_user_id_created_at_idx`(`organization_id`, `user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_rules` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `channels` JSON NOT NULL,
    `recipients` JSON NOT NULL,
    `template_key` VARCHAR(100) NULL,
    `institution_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_rules_organization_id_event_key_idx`(`organization_id`, `event_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_jobs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `recipient_count` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(1000) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_jobs_organization_id_status_idx`(`organization_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_organization_id_user_id_event_key_c_key`(`organization_id`, `user_id`, `event_key`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_devices` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `platform` VARCHAR(8) NOT NULL,
    `token` TEXT NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `device_name` VARCHAR(100) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `push_devices_organization_id_user_id_idx`(`organization_id`, `user_id`),
    UNIQUE INDEX `push_devices_organization_id_token_hash_key`(`organization_id`, `token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_providers` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `channel` VARCHAR(16) NOT NULL,
    `provider_type` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `config` JSON NOT NULL,
    `credential_secret_id` CHAR(36) NULL,
    `webhook_secret_id` CHAR(36) NULL,
    `rate_limit_per_minute` INTEGER NULL,
    `cost_per_message` DECIMAL(12, 4) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `communication_providers_organization_id_channel_is_active_idx`(`organization_id`, `channel`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_templates` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `key` VARCHAR(100) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `use_branded_layout` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `message_templates_organization_id_key_channel_idx`(`organization_id`, `key`, `channel`),
    UNIQUE INDEX `message_templates_organization_id_scope_type_target_id_key_c_key`(`organization_id`, `scope_type`, `target_id`, `key`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_template_versions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `subject` VARCHAR(500) NULL,
    `body` TEXT NOT NULL,
    `html_body` MEDIUMTEXT NULL,
    `variables` JSON NOT NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `message_template_versions_template_id_version_key`(`template_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_logs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NULL,
    `channel` VARCHAR(16) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `recipient_address` VARCHAR(254) NOT NULL,
    `recipient_user_id` CHAR(36) NULL,
    `subject` VARCHAR(500) NULL,
    `body` TEXT NULL,
    `html_body` MEDIUMTEXT NULL,
    `sensitive` BOOLEAN NOT NULL DEFAULT false,
    `template_key` VARCHAR(100) NULL,
    `template_version` INTEGER NULL,
    `event_key` VARCHAR(100) NULL,
    `campaign_id` CHAR(36) NULL,
    `provider_id` CHAR(36) NULL,
    `provider_type` VARCHAR(32) NULL,
    `provider_message_id` VARCHAR(255) NULL,
    `cost` DECIMAL(12, 4) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(1000) NULL,
    `metadata` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `sent_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `message_logs_organization_id_created_at_idx`(`organization_id`, `created_at`),
    INDEX `message_logs_organization_id_status_idx`(`organization_id`, `status`),
    INDEX `message_logs_provider_id_provider_message_id_idx`(`provider_id`, `provider_message_id`),
    INDEX `message_logs_campaign_id_idx`(`campaign_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_events` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `message_log_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `raw_status` VARCHAR(64) NULL,
    `payload` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_events_message_log_id_idx`(`message_log_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaigns` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `template_key` VARCHAR(100) NULL,
    `subject` VARCHAR(500) NULL,
    `body` TEXT NULL,
    `variables` JSON NOT NULL,
    `total_recipients` INTEGER NOT NULL DEFAULT 0,
    `sent_count` INTEGER NOT NULL DEFAULT 0,
    `failed_count` INTEGER NOT NULL DEFAULT 0,
    `scheduled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaigns_organization_id_status_scheduled_at_idx`(`organization_id`, `status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_recipients` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `campaign_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `address` VARCHAR(254) NULL,
    `name` VARCHAR(200) NULL,
    `variables` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `message_log_id` CHAR(36) NULL,
    `error` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaign_recipients_campaign_id_status_idx`(`campaign_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_clients` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `client_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `secret_last4` VARCHAR(4) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `rate_limit_per_minute` INTEGER NOT NULL DEFAULT 600,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `last_used_at` DATETIME(3) NULL,
    `last_used_ip` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `api_clients_client_id_key`(`client_id`),
    INDEX `api_clients_organization_id_status_idx`(`organization_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_scopes` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `api_client_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_scopes_organization_id_idx`(`organization_id`),
    UNIQUE INDEX `api_scopes_api_client_id_scope_key`(`api_client_id`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_usage` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `api_client_id` CHAR(36) NOT NULL,
    `method` VARCHAR(8) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `status_code` INTEGER NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_usage_api_client_id_created_at_idx`(`api_client_id`, `created_at`),
    INDEX `api_usage_organization_id_created_at_idx`(`organization_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `domain_events` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `actor_type` VARCHAR(16) NULL,
    `actor_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `domain_events_organization_id_event_key_created_at_idx`(`organization_id`, `event_key`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhooks` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `url` VARCHAR(2000) NOT NULL,
    `events` JSON NOT NULL,
    `description` VARCHAR(1000) NULL,
    `secret_id` CHAR(36) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `consecutive_failures` INTEGER NOT NULL DEFAULT 0,
    `last_success_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhooks_organization_id_is_active_idx`(`organization_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `webhook_id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_status_code` INTEGER NULL,
    `last_error` VARCHAR(1000) NULL,
    `next_attempt_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `replay_of_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_events_webhook_id_created_at_idx`(`webhook_id`, `created_at`),
    INDEX `webhook_events_organization_id_status_next_attempt_at_idx`(`organization_id`, `status`, `next_attempt_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_credentials` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('ORGANIZATION', 'GROUP', 'INSTITUTION') NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NULL,
    `provider` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `config` JSON NOT NULL,
    `secret_id` CHAR(36) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integration_credentials_organization_id_scope_type_target_id_key`(`organization_id`, `scope_type`, `target_id`, `provider`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `workflow_definitions` ADD CONSTRAINT `workflow_definitions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `workflow_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_instances` ADD CONSTRAINT `workflow_step_instances_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_instances` ADD CONSTRAINT `workflow_step_instances_instance_id_fkey` FOREIGN KEY (`instance_id`) REFERENCES `workflow_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_assignees` ADD CONSTRAINT `workflow_step_assignees_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_assignees` ADD CONSTRAINT `workflow_step_assignees_step_instance_id_fkey` FOREIGN KEY (`step_instance_id`) REFERENCES `workflow_step_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_actions` ADD CONSTRAINT `workflow_actions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_actions` ADD CONSTRAINT `workflow_actions_instance_id_fkey` FOREIGN KEY (`instance_id`) REFERENCES `workflow_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_rules` ADD CONSTRAINT `notification_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_jobs` ADD CONSTRAINT `notification_jobs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_devices` ADD CONSTRAINT `push_devices_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communication_providers` ADD CONSTRAINT `communication_providers_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_templates` ADD CONSTRAINT `message_templates_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_template_versions` ADD CONSTRAINT `message_template_versions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_template_versions` ADD CONSTRAINT `message_template_versions_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_logs` ADD CONSTRAINT `message_logs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_events` ADD CONSTRAINT `delivery_events_message_log_id_fkey` FOREIGN KEY (`message_log_id`) REFERENCES `message_logs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_clients` ADD CONSTRAINT `api_clients_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_scopes` ADD CONSTRAINT `api_scopes_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_scopes` ADD CONSTRAINT `api_scopes_api_client_id_fkey` FOREIGN KEY (`api_client_id`) REFERENCES `api_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_usage` ADD CONSTRAINT `api_usage_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_usage` ADD CONSTRAINT `api_usage_api_client_id_fkey` FOREIGN KEY (`api_client_id`) REFERENCES `api_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `domain_events` ADD CONSTRAINT `domain_events_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhooks` ADD CONSTRAINT `webhooks_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_credentials` ADD CONSTRAINT `integration_credentials_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
