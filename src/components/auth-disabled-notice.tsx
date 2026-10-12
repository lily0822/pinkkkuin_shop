export function AuthDisabledNotice({ title, message }: { title: string; message: string }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-[28px] border-2 border-penguin-peach bg-white p-6 text-center shadow-sm sm:p-8">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-penguin-pink-dark">Pinkkkuin Member</p>
      <h1 className="mt-2 text-3xl font-black text-penguin-gray">{title}</h1>
      <p className="mt-4 text-sm font-bold leading-7 text-gray-500">{message}</p>
    </section>
  );
}
