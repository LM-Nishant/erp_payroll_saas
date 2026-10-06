-- CreateTable
CREATE TABLE `organizations` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `organizations_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `groups` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `groups_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `groups_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `institutions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `type` ENUM('SCHOOL', 'COLLEGE', 'UNIVERSITY', 'INSTITUTE') NOT NULL DEFAULT 'COLLEGE',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `email` VARCHAR(200) NULL,
    `phone` VARCHAR(32) NULL,
    `address` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `institutions_organization_id_group_id_idx`(`organization_id`, `group_id`),
    INDEX `institutions_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    INDEX `institutions_group_id_idx`(`group_id`),
    UNIQUE INDEX `institutions_organization_id_code_key`(`organization_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campuses` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `address` VARCHAR(500) NULL,
    `is_main` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `campuses_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `campuses_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `campuses_institution_id_code_key`(`institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `departments_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `departments_organization_id_campus_id_idx`(`organization_id`, `campus_id`),
    INDEX `departments_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `departments_institution_id_code_key`(`institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `programs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `level` ENUM('PRE_PRIMARY', 'PRIMARY', 'SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'UNDERGRADUATE', 'POSTGRADUATE', 'DOCTORATE', 'CERTIFICATE', 'OTHER') NOT NULL DEFAULT 'UNDERGRADUATE',
    `duration_months` INTEGER NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `programs_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `programs_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `programs_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `programs_institution_id_code_key`(`institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class_sections` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `academic_year` VARCHAR(9) NULL,
    `capacity` INTEGER NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `class_sections_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `class_sections_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `class_sections_organization_id_program_id_idx`(`organization_id`, `program_id`),
    INDEX `class_sections_organization_id_campus_id_idx`(`organization_id`, `campus_id`),
    INDEX `class_sections_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `class_sections_program_id_code_academic_year_key`(`program_id`, `code`, `academic_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `groups` ADD CONSTRAINT `groups_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `institutions` ADD CONSTRAINT `institutions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `institutions` ADD CONSTRAINT `institutions_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campuses` ADD CONSTRAINT `campuses_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campuses` ADD CONSTRAINT `campuses_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programs` ADD CONSTRAINT `programs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programs` ADD CONSTRAINT `programs_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programs` ADD CONSTRAINT `programs_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sections` ADD CONSTRAINT `class_sections_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sections` ADD CONSTRAINT `class_sections_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sections` ADD CONSTRAINT `class_sections_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sections` ADD CONSTRAINT `class_sections_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sections` ADD CONSTRAINT `class_sections_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
