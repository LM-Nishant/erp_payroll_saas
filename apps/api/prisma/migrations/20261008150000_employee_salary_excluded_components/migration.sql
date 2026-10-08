-- Per-employee component opt-outs (e.g. PF not applicable).
ALTER TABLE `employee_salaries` ADD COLUMN `excluded_components` JSON NULL;
ALTER TABLE `salary_revisions` ADD COLUMN `excluded_components` JSON NULL;
