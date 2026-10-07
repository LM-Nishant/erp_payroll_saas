-- CreateTable
CREATE TABLE `subjects` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('THEORY', 'PRACTICAL', 'ELECTIVE') NOT NULL DEFAULT 'THEORY',
    `credits` DECIMAL(4, 1) NULL,
    `max_marks` INTEGER NOT NULL DEFAULT 100,
    `pass_marks` INTEGER NOT NULL DEFAULT 35,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `subjects_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `subjects_organization_id_department_id_idx`(`organization_id`, `department_id`),
    INDEX `subjects_organization_id_program_id_idx`(`organization_id`, `program_id`),
    INDEX `subjects_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `subjects_program_id_code_key`(`program_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subject_allocations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `teacher_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subject_allocations_organization_id_teacher_user_id_idx`(`organization_id`, `teacher_user_id`),
    INDEX `subject_allocations_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `subject_allocations_organization_id_department_id_idx`(`organization_id`, `department_id`),
    UNIQUE INDEX `subject_allocations_class_section_id_subject_id_key`(`class_section_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class_teacher_assignments` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `teacher_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `class_teacher_assignments_organization_id_teacher_user_id_idx`(`organization_id`, `teacher_user_id`),
    INDEX `class_teacher_assignments_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `class_teacher_assignments_class_section_id_key`(`class_section_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bell_periods` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `seq` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `is_break` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bell_periods_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    UNIQUE INDEX `bell_periods_institution_id_seq_key`(`institution_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_entries` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `day_of_week` INTEGER NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `teacher_user_id` CHAR(36) NULL,
    `room` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timetable_entries_organization_id_teacher_user_id_day_of_wee_idx`(`organization_id`, `teacher_user_id`, `day_of_week`, `period_id`),
    INDEX `timetable_entries_organization_id_institution_id_room_day_of_idx`(`organization_id`, `institution_id`, `room`, `day_of_week`, `period_id`),
    INDEX `timetable_entries_organization_id_department_id_idx`(`organization_id`, `department_id`),
    UNIQUE INDEX `timetable_entries_class_section_id_day_of_week_period_id_key`(`class_section_id`, `day_of_week`, `period_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_substitutions` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `entry_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `substitute_user_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timetable_substitutions_organization_id_substitute_user_id_d_idx`(`organization_id`, `substitute_user_id`, `date`),
    INDEX `timetable_substitutions_organization_id_institution_id_date_idx`(`organization_id`, `institution_id`, `date`),
    UNIQUE INDEX `timetable_substitutions_entry_id_date_key`(`entry_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_attendance` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `period_id` CHAR(36) NULL,
    `period_key` VARCHAR(36) NOT NULL DEFAULT '',
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY') NOT NULL,
    `remarks` VARCHAR(500) NULL,
    `marked_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_attendance_organization_id_class_section_id_date_idx`(`organization_id`, `class_section_id`, `date`),
    INDEX `student_attendance_organization_id_institution_id_date_idx`(`organization_id`, `institution_id`, `date`),
    INDEX `student_attendance_organization_id_department_id_idx`(`organization_id`, `department_id`),
    UNIQUE INDEX `student_attendance_student_id_date_period_key_key`(`student_id`, `date`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grading_scales` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `bands` JSON NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `grading_scales_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `grading_scales_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_terms` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` ENUM('UNIT_TEST', 'MID_TERM', 'FINAL', 'OTHER') NOT NULL DEFAULT 'UNIT_TEST',
    `academic_year` VARCHAR(9) NOT NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `grading_scale_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'MARKS_ENTRY', 'RESULTS_COMPUTED', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `exam_terms_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `exam_terms_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    UNIQUE INDEX `exam_terms_institution_id_academic_year_name_key`(`institution_id`, `academic_year`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_schedules` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `exam_date` DATE NOT NULL,
    `start_time` VARCHAR(5) NULL,
    `end_time` VARCHAR(5) NULL,
    `room` VARCHAR(64) NULL,
    `max_marks` INTEGER NOT NULL,
    `pass_marks` INTEGER NOT NULL,
    `marks_status` ENUM('OPEN', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `locked_at` DATETIME(3) NULL,
    `locked_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_schedules_organization_id_institution_id_exam_date_idx`(`organization_id`, `institution_id`, `exam_date`),
    INDEX `exam_schedules_organization_id_class_section_id_idx`(`organization_id`, `class_section_id`),
    INDEX `exam_schedules_organization_id_department_id_idx`(`organization_id`, `department_id`),
    UNIQUE INDEX `exam_schedules_term_id_class_section_id_subject_id_key`(`term_id`, `class_section_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_marks` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `schedule_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `marks` DECIMAL(6, 2) NULL,
    `is_absent` BOOLEAN NOT NULL DEFAULT false,
    `remarks` VARCHAR(500) NULL,
    `entered_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_marks_organization_id_student_id_idx`(`organization_id`, `student_id`),
    UNIQUE INDEX `exam_marks_schedule_id_student_id_key`(`schedule_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_results` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `department_id` CHAR(36) NOT NULL,
    `class_section_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `total_marks` DECIMAL(8, 2) NOT NULL,
    `max_total` DECIMAL(8, 2) NOT NULL,
    `percentage` DECIMAL(5, 2) NOT NULL,
    `grade` VARCHAR(8) NULL,
    `gpa` DECIMAL(4, 2) NULL,
    `rank` INTEGER NULL,
    `passed` BOOLEAN NOT NULL,
    `subjects` JSON NOT NULL,
    `computed_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_results_organization_id_class_section_id_term_id_idx`(`organization_id`, `class_section_id`, `term_id`),
    INDEX `exam_results_organization_id_student_id_idx`(`organization_id`, `student_id`),
    INDEX `exam_results_organization_id_institution_id_idx`(`organization_id`, `institution_id`),
    INDEX `exam_results_organization_id_department_id_idx`(`organization_id`, `department_id`),
    UNIQUE INDEX `exam_results_term_id_student_id_key`(`term_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subjects` ADD CONSTRAINT `subjects_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_allocations` ADD CONSTRAINT `subject_allocations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_allocations` ADD CONSTRAINT `subject_allocations_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_allocations` ADD CONSTRAINT `subject_allocations_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subject_allocations` ADD CONSTRAINT `subject_allocations_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_teacher_assignments` ADD CONSTRAINT `class_teacher_assignments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_teacher_assignments` ADD CONSTRAINT `class_teacher_assignments_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_teacher_assignments` ADD CONSTRAINT `class_teacher_assignments_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bell_periods` ADD CONSTRAINT `bell_periods_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bell_periods` ADD CONSTRAINT `bell_periods_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `bell_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_entry_id_fkey` FOREIGN KEY (`entry_id`) REFERENCES `timetable_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_substitute_user_id_fkey` FOREIGN KEY (`substitute_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `bell_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grading_scales` ADD CONSTRAINT `grading_scales_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grading_scales` ADD CONSTRAINT `grading_scales_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_terms` ADD CONSTRAINT `exam_terms_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_terms` ADD CONSTRAINT `exam_terms_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_terms` ADD CONSTRAINT `exam_terms_grading_scale_id_fkey` FOREIGN KEY (`grading_scale_id`) REFERENCES `grading_scales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_schedules` ADD CONSTRAINT `exam_schedules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_schedules` ADD CONSTRAINT `exam_schedules_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `exam_terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_schedules` ADD CONSTRAINT `exam_schedules_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_schedules` ADD CONSTRAINT `exam_schedules_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks` ADD CONSTRAINT `exam_marks_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks` ADD CONSTRAINT `exam_marks_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `exam_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks` ADD CONSTRAINT `exam_marks_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_results` ADD CONSTRAINT `exam_results_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_results` ADD CONSTRAINT `exam_results_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `exam_terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_results` ADD CONSTRAINT `exam_results_class_section_id_fkey` FOREIGN KEY (`class_section_id`) REFERENCES `class_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_results` ADD CONSTRAINT `exam_results_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

