-- Relationship check before adding this function (no cascade added, none needed):
--   community_order_items.order_id references community_orders(id) on delete cascade
--     (existing FK; already lets a community_orders delete cascade to its items).
--   community_order_items.import_batch_id references community_import_batches(id) on delete set null
--     (unrelated direction; only matters if an import batch is deleted, not an order).
--   community_remittance_submissions.order_ids and community_shipment_requests.order_ids
--     are plain uuid[] columns with no foreign key at all — deleting an order will not be
--     blocked by either table, but a deleted order_id can be left referenced inside an
--     existing remittance/shipment record's order_ids array. That is a pre-existing gap
--     (those arrays were never FK-constrained) and out of scope for this migration.
--   community_line_bindings has no relationship to community_orders/community_order_items.
-- No FK will block this delete, so no cascade behavior was added or changed.

create or replace function public.delete_community_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  delete from public.community_order_items where order_id = p_order_id;
  delete from public.community_orders where id = p_order_id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.delete_community_order(uuid) from public;
grant execute on function public.delete_community_order(uuid) to service_role;
