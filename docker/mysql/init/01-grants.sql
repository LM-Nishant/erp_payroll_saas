-- Local development only. Prisma needs to create shadow/test databases.
CREATE DATABASE IF NOT EXISTS erp_test;
GRANT ALL PRIVILEGES ON *.* TO 'erp'@'%';
FLUSH PRIVILEGES;
