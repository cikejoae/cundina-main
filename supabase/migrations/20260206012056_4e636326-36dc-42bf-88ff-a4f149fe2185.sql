-- Drop legacy tables and their dependent functions/triggers
-- Using CASCADE to automatically handle dependent triggers

-- 1. Drop functions with CASCADE (automatically removes dependent triggers)
DROP FUNCTION IF EXISTS public.update_block_member_count() CASCADE;
DROP FUNCTION IF EXISTS public.validate_block_level_progression() CASCADE;
DROP FUNCTION IF EXISTS public.sync_block_completion_to_progress() CASCADE;
DROP FUNCTION IF EXISTS public.get_top_block_for_assignment(integer) CASCADE;
DROP FUNCTION IF EXISTS public.assign_member_to_top_block(uuid, uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.increment_invited_members(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_invited_members_count() CASCADE;

-- 2. Drop the 5 legacy tables (CASCADE handles remaining FK constraints)
DROP TABLE IF EXISTS public.ranking_positions CASCADE;
DROP TABLE IF EXISTS public.block_members CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.user_level_progress CASCADE;
DROP TABLE IF EXISTS public.blocks CASCADE;
