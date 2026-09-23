begin;

do $$
declare
  v_nickname text := '__E2E_MULTI_PAY_20260923__';
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid(); v_e uuid := gen_random_uuid(); v_f uuid := gen_random_uuid();
  v_result jsonb; v_submission uuid; v_batch uuid; v_value numeric; v_count integer;
begin
  insert into public.community_orders(id, notebook_name, nickname)
  values (v_a,'E2E-1-A',v_nickname),(v_b,'E2E-2-B',v_nickname),(v_c,'E2E-2-C',v_nickname),
         (v_d,'E2E-3-D',v_nickname),(v_e,'E2E-3-E',v_nickname),(v_f,'E2E-3-F',v_nickname);

  insert into public.community_order_items(order_id,product_name,quantity,unit_price,purchase_status,arrival_status)
  values
    (v_a,'A bought',1,500,'bought','arrived'),
    (v_b,'B bought',1,800,'bought','arrived'),
    (v_b,'B not bought',1,999,'not_bought','not_arrived'),
    (v_c,'C bought',1,300,'bought','arrived'),
    (v_d,'D bought',1,500,'bought','arrived'),
    (v_e,'E bought',1,800,'bought','arrived'),
    (v_f,'F bought',1,300,'bought','arrived');

  -- One notebook: 500 - 20 = 480.
  v_result := public.submit_community_remittance(v_nickname,array[v_a],'ctbc','12345',480);
  if (v_result->>'expectedAmount')::numeric <> 480 or (v_result->>'discountTotal')::numeric <> 20 then raise exception 'one_notebook_discount_failed'; end if;
  v_submission := (v_result->>'id')::uuid;
  perform public.backend_review_community_remittance(v_submission,'approved',null);
  if (select payment_status::text from public.community_orders where id=v_a) <> 'paid' then raise exception 'one_notebook_approval_failed'; end if;

  -- Two notebooks and not_bought exclusion: 800 + 300 - 40 = 1060. First payment creates a 560 top-up.
  v_result := public.submit_community_remittance(v_nickname,array[v_b,v_c],'cathay','23456',500);
  if (v_result->>'productTotal')::numeric <> 1100 or (v_result->>'expectedAmount')::numeric <> 1060 then raise exception 'two_notebook_total_failed'; end if;
  v_submission := (v_result->>'id')::uuid; v_batch := (v_result->>'batchId')::uuid;
  v_result := public.backend_review_community_remittance(v_submission,'approved',null);
  if v_result->>'status' <> 'topup_required' or (v_result->>'remainingAmount')::numeric <> 560 then raise exception 'topup_difference_failed'; end if;
  v_result := public.submit_community_remittance(v_nickname,array[v_b,v_c],'fubon','34567',560);
  if (v_result->>'batchId')::uuid <> v_batch then raise exception 'topup_batch_changed'; end if;
  v_submission := (v_result->>'id')::uuid;
  v_result := public.backend_review_community_remittance(v_submission,'approved',null);
  if v_result->>'status' <> 'approved' then raise exception 'topup_approval_failed'; end if;
  select count(*) into v_count from public.community_orders where id in (v_b,v_c) and payment_status='paid';
  if v_count <> 2 then raise exception 'two_notebook_paid_state_failed'; end if;

  -- Three notebooks: 500 + 800 + 300 - 60 = 1540; 1600 produces a 60 refund.
  v_result := public.submit_community_remittance(v_nickname,array[v_d,v_e,v_f],'ctbc','45678',1600);
  if (v_result->>'productTotal')::numeric <> 1600 or (v_result->>'discountTotal')::numeric <> 60 or (v_result->>'expectedAmount')::numeric <> 1540 then raise exception 'three_notebook_total_failed'; end if;
  v_submission := (v_result->>'id')::uuid;
  v_result := public.backend_review_community_remittance(v_submission,'approved',null);
  if v_result->>'status' <> 'overpaid_pending_refund' or (v_result->>'overpaidAmount')::numeric <> 60 then raise exception 'overpayment_difference_failed'; end if;
  v_result := public.backend_complete_community_refund(v_submission);
  if v_result->>'status' <> 'refund_completed' or (v_result->>'refundAmount')::numeric <> 60 then raise exception 'refund_completion_failed'; end if;

  select count(*) into v_count
  from public.community_remittance_submission_orders d
  join public.community_remittance_submissions s on s.id=d.submission_id
  where s.nickname=v_nickname;
  if v_count <> 8 then raise exception 'snapshot_count_failed:%', v_count; end if;

  raise notice 'PASS: 1/2/3 notebooks, NT$20 each, not_bought exclusion, batch top-up, overpayment/refund';
end $$;

rollback;
