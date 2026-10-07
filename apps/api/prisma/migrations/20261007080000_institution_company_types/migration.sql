-- Company organizations model their companies / branches as institutions.
ALTER TABLE `institutions` MODIFY `type` ENUM('SCHOOL', 'COLLEGE', 'UNIVERSITY', 'INSTITUTE', 'COMPANY', 'BRANCH') NOT NULL DEFAULT 'COLLEGE';
