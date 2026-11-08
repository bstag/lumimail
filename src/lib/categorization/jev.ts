import { z } from "zod";
import {
	buildJevRequest,
	evaluateRules,
	interpretAnswers,
	type CategoryEvaluation,
	type CategoryMail,
	type CategorizationConfig,
} from "./engine";

export type JevEnv = { TYPESAFE_API_KEY?: string };
export function isJevConfigured(env: JevEnv): boolean {
	return Boolean(env.TYPESAFE_API_KEY?.trim());
}

export async function evaluateMail(
	env: JevEnv,
	config: CategorizationConfig,
	mail: CategoryMail,
): Promise<CategoryEvaluation> {
	const ruleTags = evaluateRules(config.rules, mail);
	if (!config.questions.some((q) => q.enabled))
		return { tags: ruleTags, uncertain: [], answers: {}, model: "rules" };
	if (!isJevConfigured(env)) throw new Error("Jev API key is not configured");
	const response = await fetch("https://api.typesafe.ai/v1/systemone", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(buildJevRequest(config, mail)),
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok) throw new Error("Jev request failed; retry later");
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Jev returned an empty response");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 65536) throw new Error("Jev response exceeded the size limit");
			chunks.push(chunk.value);
		}
	} finally {
		await reader.cancel();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const payload = z
		.object({ model: z.string().min(1).max(80), answers: z.unknown() })
		.parse(JSON.parse(new TextDecoder().decode(bytes)));
	const interpreted = interpretAnswers(config, payload.answers);
	return {
		...interpreted,
		tags: [...ruleTags, ...interpreted.tags],
		model: payload.model,
	};
}
