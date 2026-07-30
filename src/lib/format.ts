/**
 * Human-readable byte count using 1024-based units with one decimal.
 *
 * Canonical replacement for the per-component copies (attachment-list,
 * compose-form, queue-health); UI adoption happens in a later wave. Two of the
 * three existing copies label the units KB/MB, so that spelling wins here.
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
