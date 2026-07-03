interface Props {
  username: string | null;
}

export function Banner({ username }: Props) {
  return (
    <header className="bg-slate-800 px-4 py-4 text-white shadow sm:px-6">
      <h1 className="text-lg font-semibold sm:text-xl">
        Flying Neutrons Airplane Heaters
      </h1>
      {username && (
        <p className="mt-1 text-sm text-slate-300">Welcome, {username}</p>
      )}
    </header>
  );
}
