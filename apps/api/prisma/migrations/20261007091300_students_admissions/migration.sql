-- CreateTable
CREATE TABLE `student_code_sequences` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `prefix` VARCHAR(40) NOT NULL,
    `padding` INTEGER NOT NULL DEFAULT 4,
    `next_number` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_code_sequences_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `student_code_sequences_organization_id_institution_id_academ_key`(`organization_id`, `institution_id`, `academic_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `admission_no` VARCHAR(40) NOT NULL,
    `roll_no` VARCHAR(40) NULL,
    `user_id` CHAR(36) NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN', 'ALUMNI') NOT NULL DEFAULT 'ACTIVE',
    `first_name` VARCHAR(100) NOT NULL,
    `middle_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `display_name` VARCHAR(200) NOT NULL,
    `date_of_birth` DATE NULL,
    `gender` VARCHAR(24) NULL,
    `blood_group` VARCHAR(8) NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(32) NULL,
    `address` JSON NULL,
    `photo_document_id` CHAR(36) NULL,
    `admission_date` DATE NULL,
    `category` VARCHAR(64) NULL,
    `quota` VARCHAR(64) NULL,
    `previous_school` VARCHAR(200) NULL,
    `notes` VARCHAR(2000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `students_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `students_organization_id_group_id_idx`(`organization_id`, `group_id`),
    INDEX `students_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `students_organization_id_program_id_idx`(`organization_id`, `program_id`),
    INDEX `students_organization_id_class_section_id_idx`(`organization_id`, `class_section_id`),
    INDEX `students_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `students_organization_id_admission_no_key`(`organization_id`, `admission_no`),
    UNIQUE INDEX `students_organization_id_user_id_key`(`organization_id`, `user_id`),
    UNIQUE INDEX `students_organization_id_class_section_id_roll_no_key`(`organization_id`, `class_section_id`, `roll_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_enrollments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `roll_no` VARCHAR(40) NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NULL,
    `status` ENUM('ENROLLED', 'PROMOTED', 'DETAINED', 'WITHDRAWN', 'GRADUATED') NOT NULL DEFAULT 'ENROLLED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_enrollments_organization_id_student_id_idx`(`organization_id`, `student_id`),
    INDEX `student_enrollments_organization_id_institution_id_academic__idx`(`organization_id`, `institution_id`, `academic_year`),
    INDEX `student_enrollments_organization_id_class_section_id_status_idx`(`organization_id`, `class_section_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardians` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `email` VARCHAR(254) NULL,
    `occupation` VARCHAR(120) NULL,
    `address` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `guardians_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `guardians_organization_id_email_idx`(`organization_id`, `email`),
    INDEX `guardians_organization_id_phone_idx`(`organization_id`, `phone`),
    INDEX `guardians_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `guardians_organization_id_user_id_key`(`organization_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_guardians` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `guardian_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `relation` ENUM('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER') NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `can_pickup` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `student_guardians_organization_id_guardian_id_idx`(`organization_id`, `guardian_id`),
    INDEX `student_guardians_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `student_guardians_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `student_guardians_organization_id_student_id_guardian_id_key`(`organization_id`, `student_id`, `guardian_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_applications` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `application_no` VARCHAR(40) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NULL,
    `academic_year` VARCHAR(9) NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITLISTED', 'ENROLLED') NOT NULL DEFAULT 'SUBMITTED',
    `applicant_first_name` VARCHAR(100) NOT NULL,
    `applicant_middle_name` VARCHAR(100) NULL,
    `applicant_last_name` VARCHAR(100) NULL,
    `applicant_display_name` VARCHAR(200) NOT NULL,
    `date_of_birth` DATE NULL,
    `gender` VARCHAR(24) NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(32) NULL,
    `previous_school` VARCHAR(200) NULL,
    `marks_percent` DECIMAL(5, 2) NULL,
    `guardian_name` VARCHAR(200) NOT NULL,
    `guardian_relation` ENUM('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER') NOT NULL,
    `guardian_phone` VARCHAR(32) NULL,
    `guardian_email` VARCHAR(254) NULL,
    `decision_comment` VARCHAR(1000) NULL,
    `student_id` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `decided_at` DATETIME(3) NULL,
    `enrolled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `admission_applications_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `admission_applications_organization_id_program_id_idx`(`organization_id`, `program_id`),
    INDEX `admission_applications_organization_id_class_section_id_idx`(`organization_id`, `class_section_id`),
    INDEX `admission_applications_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `admission_applications_organization_id_application_no_key`(`organization_id`, `application_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `student_code_sequences` ADD CONSTRAINT `student_code_sequences_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_code_sequences` ADD CONSTRAINT `student_code_sequences_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_guardians` ADD CONSTRAINT `student_guardians_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_guardians` ADD CONSTRAINT `student_guardians_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_guardians` ADD CONSTRAINT `student_guardians_guardian_id_fkey` FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_guardians` ADD CONSTRAINT `student_guardians_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_guardians` ADD CONSTRAINT `student_guardians_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
