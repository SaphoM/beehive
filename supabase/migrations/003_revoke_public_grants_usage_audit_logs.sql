-- ============================================================
-- 003_revoke_public_grants_usage_audit_logs.sql
-- Defense-in-depth follow-up to 002_enable_rls_usage_audit_logs.sql.
--
-- RLS enabled with no policies already denies all access to anon/
-- authenticated regardless of table grants — but both roles still held
-- Supabase's default full CRUD grants (SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER) on usage and audit_logs, making RLS the
-- only barrier. Revoking those grants removes the single-point-of-failure:
-- even a future permissive RLS policy added by mistake wouldn't expose
-- these tables, since the grant itself would still block it.
--
-- Neither table is read from or written to by any client-side code (both
-- are written only by trusted server-side/service-role processes, which
-- always bypass RLS and grants) — zero behavior change for the app.
-- ============================================================

REVOKE ALL ON TABLE usage FROM anon, authenticated;
REVOKE ALL ON TABLE audit_logs FROM anon, authenticated;
