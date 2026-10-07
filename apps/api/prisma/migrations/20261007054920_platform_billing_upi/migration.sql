-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `line_items` JSON NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL,
    ADD COLUMN `submitted_by_user_id` CHAR(36) NULL,
    ADD COLUMN `submitted_note` VARCHAR(500) NULL,
    ADD COLUMN `submitted_reference` VARCHAR(128) NULL,
    ADD COLUMN `subtotal_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `tax_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `tax_rate_bps` INTEGER NOT NULL DEFAULT 0,
    MODIFY `status` ENUM('DRAFT', 'OPEN', 'PAYMENT_SUBMITTED', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE `platform_billing_settings` (
    `id` VARCHAR(36) NOT NULL,
    `seller_name` VARCHAR(200) NOT NULL,
    `seller_address` VARCHAR(1000) NULL,
    `gstin` VARCHAR(20) NULL,
    `contact_email` VARCHAR(254) NULL,
    `contact_phone` VARCHAR(40) NULL,
    `upi_id` VARCHAR(100) NULL,
    `upi_payee_name` VARCHAR(100) NULL,
    `default_tax_rate_bps` INTEGER NOT NULL DEFAULT 1800,
    `invoice_terms` VARCHAR(1000) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: legacy invoices have no tax, so subtotal = amount.
UPDATE `invoices` SET `subtotal_cents` = `amount_cents`;
