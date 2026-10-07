-- CreateTable
CREATE TABLE `library_books` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `item_type` VARCHAR(16) NOT NULL DEFAULT 'BOOK',
    `isbn` VARCHAR(20) NULL,
    `title` VARCHAR(300) NOT NULL,
    `subtitle` VARCHAR(300) NULL,
    `authors` JSON NULL,
    `author_text` VARCHAR(1000) NULL,
    `publisher` VARCHAR(200) NULL,
    `edition` VARCHAR(60) NULL,
    `publication_year` INTEGER NULL,
    `category` VARCHAR(100) NULL,
    `language` VARCHAR(40) NULL,
    `tags` JSON NULL,
    `call_number` VARCHAR(60) NULL,
    `url` VARCHAR(500) NULL,
    `description` VARCHAR(2000) NULL,
    `cover_document_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_books_organization_id_institution_id_title_idx`(`organization_id`, `institution_id`, `title`),
    INDEX `library_books_organization_id_isbn_idx`(`organization_id`, `isbn`),
    INDEX `library_books_organization_id_category_idx`(`organization_id`, `category`),
    INDEX `library_books_organization_id_deleted_at_idx`(`organization_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_copies` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `book_id` CHAR(36) NOT NULL,
    `accession_no` VARCHAR(40) NOT NULL,
    `barcode` VARCHAR(64) NOT NULL,
    `shelf` VARCHAR(40) NULL,
    `rack` VARCHAR(40) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    `condition` VARCHAR(40) NULL,
    `price` DECIMAL(12, 2) NULL,
    `acquired_on` DATE NULL,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_copies_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `library_copies_organization_id_book_id_status_idx`(`organization_id`, `book_id`, `status`),
    UNIQUE INDEX `library_copies_organization_id_barcode_key`(`organization_id`, `barcode`),
    UNIQUE INDEX `library_copies_organization_id_institution_id_accession_no_key`(`organization_id`, `institution_id`, `accession_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_policies` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `member_type` VARCHAR(16) NOT NULL,
    `max_books` INTEGER NOT NULL DEFAULT 3,
    `loan_days` INTEGER NOT NULL DEFAULT 14,
    `max_renewals` INTEGER NOT NULL DEFAULT 1,
    `fine_per_day` DECIMAL(10, 2) NOT NULL DEFAULT 1,
    `max_fine` DECIMAL(12, 2) NOT NULL DEFAULT 100,
    `hold_days` INTEGER NOT NULL DEFAULT 3,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `library_policies_organization_id_institution_id_member_type_key`(`organization_id`, `institution_id`, `member_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_loans` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `copy_id` CHAR(36) NOT NULL,
    `book_id` CHAR(36) NOT NULL,
    `member_type` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `member_user_id` CHAR(36) NULL,
    `member_name` VARCHAR(200) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL,
    `due_date` DATE NOT NULL,
    `returned_at` DATETIME(3) NULL,
    `renew_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ISSUED',
    `fine_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `return_condition` VARCHAR(16) NULL,
    `reminder_count` INTEGER NOT NULL DEFAULT 0,
    `last_reminder_at` DATETIME(3) NULL,
    `issued_by_user_id` CHAR(36) NULL,
    `returned_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_loans_organization_id_institution_id_status_due_date_idx`(`organization_id`, `institution_id`, `status`, `due_date`),
    INDEX `library_loans_organization_id_copy_id_status_idx`(`organization_id`, `copy_id`, `status`),
    INDEX `library_loans_organization_id_book_id_idx`(`organization_id`, `book_id`),
    INDEX `library_loans_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `library_loans_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    INDEX `library_loans_organization_id_member_user_id_idx`(`organization_id`, `member_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_reservations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `book_id` CHAR(36) NOT NULL,
    `copy_id` CHAR(36) NULL,
    `member_type` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `member_user_id` CHAR(36) NULL,
    `member_name` VARCHAR(200) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'WAITING',
    `ready_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `loan_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_reservations_organization_id_book_id_status_created__idx`(`organization_id`, `book_id`, `status`, `created_at`),
    INDEX `library_reservations_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `library_reservations_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `library_reservations_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_fines` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `loan_id` CHAR(36) NULL,
    `member_type` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `member_user_id` CHAR(36) NULL,
    `member_name` VARCHAR(200) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `note` VARCHAR(500) NULL,
    `external_charge_id` VARCHAR(64) NULL,
    `settled_at` DATETIME(3) NULL,
    `settled_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_fines_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `library_fines_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `library_fines_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    INDEX `library_fines_organization_id_loan_id_idx`(`organization_id`, `loan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_stock_verifications` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `scanned_barcodes` JSON NULL,
    `result` JSON NULL,
    `started_by_user_id` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_stock_verifications_organization_id_institution_id_s_idx`(`organization_id`, `institution_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `library_books` ADD CONSTRAINT `library_books_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_books` ADD CONSTRAINT `library_books_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_copies` ADD CONSTRAINT `library_copies_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_copies` ADD CONSTRAINT `library_copies_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_copies` ADD CONSTRAINT `library_copies_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_policies` ADD CONSTRAINT `library_policies_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_policies` ADD CONSTRAINT `library_policies_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_loans` ADD CONSTRAINT `library_loans_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_loans` ADD CONSTRAINT `library_loans_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_loans` ADD CONSTRAINT `library_loans_copy_id_fkey` FOREIGN KEY (`copy_id`) REFERENCES `library_copies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_loans` ADD CONSTRAINT `library_loans_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_copy_id_fkey` FOREIGN KEY (`copy_id`) REFERENCES `library_copies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `library_loans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_stock_verifications` ADD CONSTRAINT `library_stock_verifications_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_stock_verifications` ADD CONSTRAINT `library_stock_verifications_institution_id_fkey` FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

