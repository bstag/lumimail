-- Rows written before the responder used the canonical address normalizer hold a
-- whole From header, e.g. `"admin" <admin@example.com`, rather than a bare
-- address. A normalized lookup can never equal those values, so they are inert
-- dead weight; delete them and let the window start cleanly.
--
-- The predicate matches only characters that cannot appear in a normalized
-- address, so a correctly stored row is never removed.
DELETE FROM `vacation_reply_log`
WHERE `sender_address` LIKE '%<%'
   OR `sender_address` LIKE '%>%'
   OR `sender_address` LIKE '%"%'
   OR `sender_address` LIKE '% %';
