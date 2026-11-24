/** The deployment designates one organization owner to access shared storage. */
export function isInstanceOperator(env: CloudflareEnv, userId: string): boolean {
	return env.INSTANCE_OPERATOR_USER_ID === userId;
}
