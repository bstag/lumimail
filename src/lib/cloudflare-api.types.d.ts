export type CfDnsRecord = {
	type?: string;
	name?: string;
	content?: string;
	priority?: number;
	ttl?: number;
};

export type CfSendingDomain = {
	tag: string;
	name: string;
	enabled: boolean;
	created?: string;
	modified?: string;
	dkim_selector?: string;
	return_path_domain?: string;
	preview_enabled?: boolean;
};

export type CfApiError = {
	code?: number;
	message: string;
	documentation_url?: string;
	source?: unknown;
};

export type CfResponse<T> = {
	success: boolean;
	errors: CfApiError[];
	messages?: CfApiError[];
	result: T;
};

export type CfAuth =
	| {
			kind: "token";
			token: string;
	  }
	| {
			kind: "global-key";
			email: string;
			key: string;
	  };

/**
 * An account-level Email Routing destination address. `verified` is an ISO
 * timestamp set once the recipient confirms Cloudflare's verification email,
 * and is absent while verification is pending.
 */
export type CfDestinationAddress = {
	id?: string;
	tag?: string;
	email: string;
	verified?: string | null;
	created?: string;
	modified?: string;
};

export type CfEmailRoutingRule = {
	id?: string;
	actions?: {
		type: "drop" | "forward" | "worker";
		value?: string[];
	}[];
	enabled?: boolean;
	matchers?: {
		type: "all" | "literal";
		field?: "to";
		value?: string;
	}[];
	name?: string;
	priority?: number;
	source?: "api" | "wrangler";
	tag?: string;
};
