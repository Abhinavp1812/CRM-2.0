-- "Converted" was set to close the followup when the remark list was reduced,
-- treating it as a terminal state. It shouldn't be: the whole point of
-- tracking a converted customer is to nudge them again for a repeat booking,
-- same as "Booked". Give it the same 20-day re-engagement cadence and stop
-- deleting the followup row when it's chosen.
UPDATE "RemarkOption"
SET "closesFollowup" = false, "defaultDaysAhead" = 20
WHERE "label" = 'Converted';
