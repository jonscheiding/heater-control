interface Props {
  username: string | null;
  onLogout?: (() => void) | undefined;
}

export function Banner({ username, onLogout }: Props) {
  return (
    <header className="bg-slate-800 px-4 py-4 text-white shadow sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold sm:text-xl">
            Flying Neutrons Airplane Heaters
          </h1>
          {username && (
            <p className="mt-1 text-sm text-slate-300">Welcome, {username}</p>
          )}
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Log out
          </button>
        )}
      </div>
    </header>
  );
}
