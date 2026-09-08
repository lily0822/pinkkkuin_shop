-- Staging-only cleanup to align table grants with the Production final matrix.
-- Apply to pinkkkuin-staging only. Do not apply to Production.
-- Does not modify business data.

revoke references, trigger, truncate on public.member_addresses from authenticated;

revoke references, trigger, truncate on public.member_line_accounts from anon;
revoke references, trigger, truncate on public.member_line_accounts from authenticated;

revoke references, trigger, truncate on public.member_profiles from authenticated;

revoke references, trigger, truncate on public.order_items from anon;
revoke references, trigger, truncate on public.order_items from authenticated;
revoke insert, update, delete on public.order_items from service_role;

revoke references, trigger, truncate on public.orders from anon;
revoke references, trigger, truncate on public.orders from authenticated;
revoke insert, update, delete on public.orders from service_role;

grant select on public.order_items to authenticated;
grant select on public.order_items to service_role;

grant select on public.orders to authenticated;
grant select on public.orders to service_role;
