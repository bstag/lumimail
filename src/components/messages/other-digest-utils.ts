/** The bulk endpoint binds each ID; D1 allows about 100 bound parameters per statement. */
export const BULK_ID_CHUNK = 80;

export function chunkIds(ids: readonly string[], size = BULK_ID_CHUNK): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
	return chunks;
}
