alter table schedule_settings enable row level security;

drop policy if exists "Public can read schedule settings" on schedule_settings;
create policy "Public can read schedule settings"
on schedule_settings for select
using (true);
