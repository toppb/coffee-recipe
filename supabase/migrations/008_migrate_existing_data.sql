-- Run this AFTER the original owner has signed up and has a profile.
-- Replace <OWNER_UUID> with their actual auth.users id.

-- Step 1: Assign all existing coffees to the owner
-- UPDATE coffees SET user_id = '<OWNER_UUID>' WHERE user_id IS NULL;

-- Step 2: Once all rows have a user_id, make the column NOT NULL
-- ALTER TABLE coffees ALTER COLUMN user_id SET NOT NULL;
