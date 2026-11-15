"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <h1 className="text-lg font-bold">This page could not load</h1>
      <p className="mt-2 text-sm text-muted">
        The database or the sync worker may be temporarily unavailable. Your portfolio data is safe.
      </p>
      <button className="btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
