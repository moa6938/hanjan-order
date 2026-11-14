-- The sender validates the existing admin PIN before a device-only test.
-- service_role still has to pass that PIN check; table permissions do not change.
grant execute on function public.admin_check_pin(text) to service_role;
