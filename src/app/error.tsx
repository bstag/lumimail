"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-ink">Something went wrong</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:brightness-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
