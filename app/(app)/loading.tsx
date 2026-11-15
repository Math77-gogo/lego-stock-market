export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="max-w-3xl">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-3 h-12 w-72" />
      <div className="skeleton mt-3 h-4 w-32" />
      <div className="skeleton mt-8 h-60 w-full rounded-card" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-16 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
