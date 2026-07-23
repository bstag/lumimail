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
