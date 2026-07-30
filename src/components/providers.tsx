"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster, showErrorToast } from "./ui/toast";
import {
	registerQueryClientAccountReset,
	shouldToastMutationError,
	toMutationErrorMessage,
} from "./providers-utils";

export function Providers({ children }: { children: React.ReactNode }) {
	const [client] = useState(
		() =>
			new QueryClient({
				// Safety net: any mutation without its own error handling surfaces
				// its failure as a toast instead of failing silently (T-22).
				mutationCache: new MutationCache({
					onError: (error, _variables, _context, mutation) => {
						if (!shouldToastMutationError(mutation)) return;
						showErrorToast(toMutationErrorMessage(error));
					},
				}),
				defaultOptions: {
					queries: {
						refetchOnMount: false,
						refetchOnReconnect: false,
						refetchOnWindowFocus: false,
						staleTime: 60_000,
					},
				},
			}),
	);

	useEffect(() => registerQueryClientAccountReset(client), [client]);

	return (
		<QueryClientProvider client={client}>
			{children}
			<Toaster />
		</QueryClientProvider>
	);
}
