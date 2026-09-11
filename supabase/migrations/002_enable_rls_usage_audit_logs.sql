-- ============================================================
-- 002_enable_rls_usage_audit_logs.sql
-- Fixes Supabase security advisor finding: RLS Disabled in Public
-- ("Table public.usage is public, but RLS has not been enabled" — a
-- publicly-readable/writable table). audit_logs had the same gap and is
-- fixed alongside it for the same reason.
--
-- Neither table is read from or written to by any client-side code (both
-- are written only by trusted server-side/service-role processes, which
-- bypass RLS entirely) — so enabling RLS with no permissive policies is a
-- pure lockdown with zero behavior change for the app.
-- ============================================================

ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
