-- Update Account types for clearing accounts to ensure permanence across deployments
UPDATE "Account" SET "accountType" = 'clearing' WHERE "accountCode" IN ('1060', '1065');
