import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm text-muted">This page or item does not exist.</p>
      <Link href="/" className="btn-primary mt-6">
        Back to portfolio
      </Link>
    </div>
  );
}
