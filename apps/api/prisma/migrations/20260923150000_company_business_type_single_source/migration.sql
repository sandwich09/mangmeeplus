-- First deploy the application that no longer reads these legacy fields. The physical
-- drop is a separately reviewed contract migration after every serving instance uses
-- the new schema and a database clone has proved the data-retention and rollback plan.
SELECT 1;
