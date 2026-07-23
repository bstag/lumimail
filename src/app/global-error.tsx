"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="antialiased bg-surface">
        <div className="flex min-h-dvh items-center justify-center p-8">
          <div className="text-center max-w-md">
            <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
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
      </body>
    </html>
  );
}
