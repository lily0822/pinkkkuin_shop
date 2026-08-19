type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function SectionHeading({ eyebrow, title, description }: SectionHeadingProps) {
  return (
    <div className="max-w-3xl">
      {eyebrow ? (
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-brand-pink-dark">{eyebrow}</p>
      ) : null}
      <h2 className="text-2xl font-black leading-tight text-foreground sm:text-3xl">{title}</h2>
      {description ? <p className="mt-3 text-sm leading-7 text-muted sm:text-base">{description}</p> : null}
    </div>
  );
}
