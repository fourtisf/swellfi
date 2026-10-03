-- Fill ids become "<userId>:<hash>:<tid>": both sides of a trade between two Swellfi users
-- share hash and tid. Old ids ("<hash>:<tid>") start with 0x.
UPDATE "Fill" SET "id" = "userId" || ':' || "id" WHERE "id" LIKE '0x%';
