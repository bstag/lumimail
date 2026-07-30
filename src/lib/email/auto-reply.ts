/**
 * Headers every Lumimail auto-reply carries.
 *
 * `Auto-Submitted: auto-replied` is the RFC 3834 marker. It is what makes two
 * enabled responders terminate instead of answering each other forever, because
 * our own suppression rules recognise it on the way back in.
 *
 * Lives in its own module so both the vacation suppression rules
 * (`vacation.ts`) and the outbound delivery consumer
 * (`outbound/consumer.ts`) can import it without either depending on the
 * other (T-32).
 */
export const AUTO_REPLY_HEADERS: Record<string, string> = {
	"Auto-Submitted": "auto-replied",
	"X-Auto-Response-Suppress": "All",
};
