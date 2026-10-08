-- CreateTable
CREATE TABLE `transport_vehicles` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `reg_no` VARCHAR(32) NOT NULL,
    `vehicle_type` VARCHAR(16) NOT NULL DEFAULT 'BUS',
    `make` VARCHAR(80) NULL,
    `capacity` INTEGER NOT NULL,
    `gps_device_id` VARCHAR(64) NULL,
    `insurance_expiry` DATE NULL,
    `fitness_expiry` DATE NULL,
    `permit_expiry` DATE NULL,
    `pollution_expiry` DATE NULL,
    `next_service_date` DATE NULL,
    `odometer_km` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_vehicles_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    UNIQUE INDEX `transport_vehicles_organization_id_reg_no_key`(`organization_id`, `reg_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_staff` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'DRIVER',
    `name` VARCHAR(200) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `licence_no` VARCHAR(40) NULL,
    `licence_expiry` DATE NULL,
    `vehicle_id` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_staff_organization_id_institution_id_role_status_idx`(`organization_id`, `institution_id`, `role`, `status`),
    INDEX `transport_staff_organization_id_employee_id_idx`(`organization_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_routes` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `vehicle_id` CHAR(36) NULL,
    `driver_id` CHAR(36) NULL,
    `attendant_id` CHAR(36) NULL,
    `distance_km` DECIMAL(8, 2) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_routes_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    UNIQUE INDEX `transport_routes_organization_id_institution_id_code_key`(`organization_id`, `institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_stops` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `route_id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `pickup_time` VARCHAR(5) NULL,
    `drop_time` VARCHAR(5) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `distance_km` DECIMAL(8, 2) NULL,
    `fare_amount` DECIMAL(12, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_stops_organization_id_route_id_sequence_idx`(`organization_id`, `route_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_fare_slabs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `min_km` DECIMAL(8, 2) NOT NULL,
    `max_km` DECIMAL(8, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `frequency` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_fare_slabs_organization_id_institution_id_min_km_idx`(`organization_id`, `institution_id`, `min_km`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_allocations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `passenger_type` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `route_id` CHAR(36) NOT NULL,
    `stop_id` CHAR(36) NOT NULL,
    `trip_type` VARCHAR(8) NOT NULL DEFAULT 'BOTH',
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `fare_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_allocations_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    INDEX `transport_allocations_organization_id_route_id_status_idx`(`organization_id`, `route_id`, `status`),
    INDEX `transport_allocations_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `transport_allocations_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_charges` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `allocation_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `period` VARCHAR(7) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `external_ref` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_charges_organization_id_institution_id_period_stat_idx`(`organization_id`, `institution_id`, `period`, `status`),
    UNIQUE INDEX `transport_charges_allocation_id_period_key`(`allocation_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_trips` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `route_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NULL,
    `driver_id` CHAR(36) NULL,
    `trip_date` DATE NOT NULL,
    `direction` VARCHAR(8) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED',
    `started_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `start_odometer_km` INTEGER NULL,
    `end_odometer_km` INTEGER NULL,
    `delay_minutes` INTEGER NULL,
    `notes` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_trips_organization_id_institution_id_trip_date_idx`(`organization_id`, `institution_id`, `trip_date`),
    UNIQUE INDEX `transport_trips_route_id_trip_date_direction_key`(`route_id`, `trip_date`, `direction`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_boardings` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `trip_id` CHAR(36) NOT NULL,
    `allocation_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `recorded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_boardings_organization_id_allocation_id_idx`(`organization_id`, `allocation_id`),
    UNIQUE INDEX `transport_boardings_trip_id_allocation_id_key`(`trip_id`, `allocation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_incidents` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `trip_id` CHAR(36) NULL,
    `route_id` CHAR(36) NULL,
    `vehicle_id` CHAR(36) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `severity` VARCHAR(16) NOT NULL DEFAULT 'LOW',
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `resolution` VARCHAR(1000) NULL,
    `reported_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_incidents_organization_id_institution_id_occurred__idx`(`organization_id`, `institution_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_fuel_logs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `log_date` DATE NOT NULL,
    `litres` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `odometer_km` INTEGER NULL,
    `vendor` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_fuel_logs_organization_id_vehicle_id_log_date_idx`(`organization_id`, `vehicle_id`, `log_date`),
    INDEX `transport_fuel_logs_organization_id_institution_id_log_date_idx`(`organization_id`, `institution_id`, `log_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_maintenance_logs` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `service_date` DATE NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'SERVICE',
    `description` VARCHAR(1000) NOT NULL,
    `cost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `odometer_km` INTEGER NULL,
    `vendor` VARCHAR(120) NULL,
    `next_service_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_maintenance_logs_organization_id_vehicle_id_servic_idx`(`organization_id`, `vehicle_id`, `service_date`),
    INDEX `transport_maintenance_logs_organization_id_institution_id_se_idx`(`organization_id`, `institution_id`, `service_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostels` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `hostel_type` VARCHAR(16) NOT NULL,
    `warden_employee_id` CHAR(36) NULL,
    `warden_user_id` CHAR(36) NULL,
    `phone` VARCHAR(32) NULL,
    `address` VARCHAR(500) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostels_organization_id_institution_id_status_idx`(`organization_id`, `institution_id`, `status`),
    UNIQUE INDEX `hostels_organization_id_institution_id_code_key`(`organization_id`, `institution_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_blocks` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `floors` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_blocks_organization_id_hostel_id_idx`(`organization_id`, `hostel_id`),
    UNIQUE INDEX `hostel_blocks_hostel_id_name_key`(`hostel_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_rooms` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `block_id` CHAR(36) NULL,
    `floor` INTEGER NOT NULL DEFAULT 0,
    `room_no` VARCHAR(20) NOT NULL,
    `room_type` VARCHAR(16) NOT NULL DEFAULT 'DOUBLE',
    `capacity` INTEGER NOT NULL,
    `amenities` JSON NULL,
    `monthly_rent` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_rooms_organization_id_hostel_id_status_idx`(`organization_id`, `hostel_id`, `status`),
    UNIQUE INDEX `hostel_rooms_hostel_id_room_no_key`(`hostel_id`, `room_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_beds` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `bed_no` VARCHAR(10) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_beds_organization_id_hostel_id_status_idx`(`organization_id`, `hostel_id`, `status`),
    UNIQUE INDEX `hostel_beds_room_id_bed_no_key`(`room_id`, `bed_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_mess_plans` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NULL,
    `monthly_fee` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `hostel_mess_plans_hostel_id_name_key`(`hostel_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_allocations` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `bed_id` CHAR(36) NOT NULL,
    `occupant_type` VARCHAR(16) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `mess_plan_id` CHAR(36) NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `monthly_rent` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_allocations_organization_id_hostel_id_status_idx`(`organization_id`, `hostel_id`, `status`),
    INDEX `hostel_allocations_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    INDEX `hostel_allocations_organization_id_employee_id_status_idx`(`organization_id`, `employee_id`, `status`),
    INDEX `hostel_allocations_organization_id_bed_id_status_idx`(`organization_id`, `bed_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_charges` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `allocation_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NULL,
    `period` VARCHAR(7) NOT NULL,
    `rent_amount` DECIMAL(12, 2) NOT NULL,
    `mess_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `external_ref` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_charges_organization_id_institution_id_period_status_idx`(`organization_id`, `institution_id`, `period`, `status`),
    UNIQUE INDEX `hostel_charges_allocation_id_period_key`(`allocation_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_visitors` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `visitor_name` VARCHAR(200) NOT NULL,
    `relation` VARCHAR(60) NULL,
    `phone` VARCHAR(32) NULL,
    `id_proof` VARCHAR(80) NULL,
    `purpose` VARCHAR(300) NULL,
    `check_in_at` DATETIME(3) NOT NULL,
    `check_out_at` DATETIME(3) NULL,
    `recorded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_visitors_organization_id_hostel_id_check_in_at_idx`(`organization_id`, `hostel_id`, `check_in_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_outpasses` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `pass_type` VARCHAR(16) NOT NULL DEFAULT 'OUTING',
    `from_at` DATETIME(3) NOT NULL,
    `to_at` DATETIME(3) NOT NULL,
    `destination` VARCHAR(200) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `workflow_instance_id` CHAR(36) NULL,
    `requested_by_user_id` CHAR(36) NULL,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_comment` VARCHAR(1000) NULL,
    `decided_at` DATETIME(3) NULL,
    `out_at` DATETIME(3) NULL,
    `returned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_outpasses_organization_id_hostel_id_status_idx`(`organization_id`, `hostel_id`, `status`),
    INDEX `hostel_outpasses_organization_id_student_id_status_idx`(`organization_id`, `student_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_movements` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `outpass_id` CHAR(36) NULL,
    `direction` VARCHAR(4) NOT NULL,
    `at` DATETIME(3) NOT NULL,
    `notes` VARCHAR(300) NULL,
    `recorded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_movements_organization_id_hostel_id_at_idx`(`organization_id`, `hostel_id`, `at`),
    INDEX `hostel_movements_organization_id_student_id_at_idx`(`organization_id`, `student_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_complaints` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NULL,
    `student_id` CHAR(36) NULL,
    `category` VARCHAR(24) NOT NULL DEFAULT 'MAINTENANCE',
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `priority` VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `resolution` VARCHAR(1000) NULL,
    `raised_by_user_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_complaints_organization_id_hostel_id_status_idx`(`organization_id`, `hostel_id`, `status`),
    INDEX `hostel_complaints_organization_id_student_id_idx`(`organization_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_roll_calls` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `institution_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `roll_date` DATE NOT NULL,
    `session` VARCHAR(16) NOT NULL DEFAULT 'NIGHT',
    `taken_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_roll_calls_organization_id_hostel_id_roll_date_idx`(`organization_id`, `hostel_id`, `roll_date`),
    UNIQUE INDEX `hostel_roll_calls_hostel_id_roll_date_session_key`(`hostel_id`, `roll_date`, `session`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_roll_call_entries` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `roll_call_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_roll_call_entries_organization_id_student_id_idx`(`organization_id`, `student_id`),
    UNIQUE INDEX `hostel_roll_call_entries_roll_call_id_student_id_key`(`roll_call_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transport_vehicles` ADD CONSTRAINT `transport_vehicles_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_staff` ADD CONSTRAINT `transport_staff_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_staff` ADD CONSTRAINT `transport_staff_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `transport_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_attendant_id_fkey` FOREIGN KEY (`attendant_id`) REFERENCES `transport_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_stops` ADD CONSTRAINT `transport_stops_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_stops` ADD CONSTRAINT `transport_stops_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_fare_slabs` ADD CONSTRAINT `transport_fare_slabs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_allocations` ADD CONSTRAINT `transport_allocations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_allocations` ADD CONSTRAINT `transport_allocations_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_allocations` ADD CONSTRAINT `transport_allocations_stop_id_fkey` FOREIGN KEY (`stop_id`) REFERENCES `transport_stops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_charges` ADD CONSTRAINT `transport_charges_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_charges` ADD CONSTRAINT `transport_charges_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `transport_allocations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `transport_staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_boardings` ADD CONSTRAINT `transport_boardings_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_boardings` ADD CONSTRAINT `transport_boardings_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `transport_trips`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_boardings` ADD CONSTRAINT `transport_boardings_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `transport_allocations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_incidents` ADD CONSTRAINT `transport_incidents_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_incidents` ADD CONSTRAINT `transport_incidents_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `transport_trips`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_incidents` ADD CONSTRAINT `transport_incidents_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_incidents` ADD CONSTRAINT `transport_incidents_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_fuel_logs` ADD CONSTRAINT `transport_fuel_logs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_fuel_logs` ADD CONSTRAINT `transport_fuel_logs_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_maintenance_logs` ADD CONSTRAINT `transport_maintenance_logs_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_maintenance_logs` ADD CONSTRAINT `transport_maintenance_logs_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostels` ADD CONSTRAINT `hostels_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_blocks` ADD CONSTRAINT `hostel_blocks_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_blocks` ADD CONSTRAINT `hostel_blocks_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_rooms` ADD CONSTRAINT `hostel_rooms_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_rooms` ADD CONSTRAINT `hostel_rooms_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_rooms` ADD CONSTRAINT `hostel_rooms_block_id_fkey` FOREIGN KEY (`block_id`) REFERENCES `hostel_blocks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_beds` ADD CONSTRAINT `hostel_beds_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_beds` ADD CONSTRAINT `hostel_beds_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_beds` ADD CONSTRAINT `hostel_beds_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_mess_plans` ADD CONSTRAINT `hostel_mess_plans_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_mess_plans` ADD CONSTRAINT `hostel_mess_plans_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_allocations` ADD CONSTRAINT `hostel_allocations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_allocations` ADD CONSTRAINT `hostel_allocations_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_allocations` ADD CONSTRAINT `hostel_allocations_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_allocations` ADD CONSTRAINT `hostel_allocations_bed_id_fkey` FOREIGN KEY (`bed_id`) REFERENCES `hostel_beds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_allocations` ADD CONSTRAINT `hostel_allocations_mess_plan_id_fkey` FOREIGN KEY (`mess_plan_id`) REFERENCES `hostel_mess_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_charges` ADD CONSTRAINT `hostel_charges_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_charges` ADD CONSTRAINT `hostel_charges_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `hostel_allocations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_visitors` ADD CONSTRAINT `hostel_visitors_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_visitors` ADD CONSTRAINT `hostel_visitors_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_outpasses` ADD CONSTRAINT `hostel_outpasses_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_outpasses` ADD CONSTRAINT `hostel_outpasses_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_movements` ADD CONSTRAINT `hostel_movements_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_movements` ADD CONSTRAINT `hostel_movements_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_movements` ADD CONSTRAINT `hostel_movements_outpass_id_fkey` FOREIGN KEY (`outpass_id`) REFERENCES `hostel_outpasses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_roll_calls` ADD CONSTRAINT `hostel_roll_calls_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_roll_calls` ADD CONSTRAINT `hostel_roll_calls_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_roll_call_entries` ADD CONSTRAINT `hostel_roll_call_entries_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_roll_call_entries` ADD CONSTRAINT `hostel_roll_call_entries_roll_call_id_fkey` FOREIGN KEY (`roll_call_id`) REFERENCES `hostel_roll_calls`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

