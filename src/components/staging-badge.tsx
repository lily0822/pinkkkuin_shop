function isStagingEnvironment() {
  return [process.env.APP_ENV, process.env.SUPABASE_ENV]
    .some((value) => value?.trim().toLowerCase() === "staging");
}

export function StagingBadge() {
  if (!isStagingEnvironment()) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[80] rounded-full border border-amber-300 bg-amber-100/95 px-3 py-1 text-[11px] font-black tracking-[0.08em] text-amber-800 shadow-sm backdrop-blur sm:right-4 sm:top-4">
      STAGING
    </div>
  );
}
