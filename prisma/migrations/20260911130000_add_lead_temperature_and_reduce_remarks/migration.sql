-- Adds the Hot/Warm/Cold lead-temperature classification to Followup + ActivityLog,
-- and reduces the RemarkOption list down to the 9 approved remarks. Old remarks are
-- deactivated (isActive = false), never deleted, so any customer whose currentRemark
-- or activity history references one keeps that history intact.

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD');

-- AlterTable
ALTER TABLE "Followup" ADD COLUMN "leadTemperature" "LeadTemperature";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN "leadTemperature" "LeadTemperature";

-- CreateIndex
CREATE INDEX "Followup_leadTemperature_idx" ON "Followup"("leadTemperature");

-- Rename existing options that map directly onto the new reduced list, so their
-- id / historical settings are preserved rather than deactivated + recreated.
UPDATE "RemarkOption" SET "label" = 'Callback' WHERE "label" = 'Call back';
UPDATE "RemarkOption" SET "label" = 'Not Connected' WHERE "label" = 'No answer';
UPDATE "RemarkOption" SET "label" = 'Location Issue' WHERE "label" = 'Location issue';

-- Deactivate every remark that isn't part of the new reduced list.
UPDATE "RemarkOption"
SET "isActive" = false
WHERE "label" NOT IN (
  'Potential (Makeup Artist)', 'Potential (Salon)', 'Callback', 'Follow-up',
  'Booked', 'Converted', 'Not Interested', 'Not Connected', 'Location Issue'
);

-- Create the brand-new options and (re)activate/normalize all 9, whether they
-- already existed under their old name or are being created fresh here.
INSERT INTO "RemarkOption" ("id", "label", "sortOrder", "defaultDaysAhead", "autoFlagDnc", "closesFollowup", "isActive")
VALUES
  ('remarkopt_potential_makeup_artist', 'Potential (Makeup Artist)', 0, 7,    false, false, true),
  ('remarkopt_potential_salon',         'Potential (Salon)',         1, 7,    false, false, true),
  ('remarkopt_callback',                'Callback',                  2, 1,    false, false, true),
  ('remarkopt_followup',                'Follow-up',                 3, 7,    false, false, true),
  ('remarkopt_booked',                  'Booked',                    4, 20,   false, false, true),
  ('remarkopt_converted',               'Converted',                 5, NULL, false, true,  true),
  ('remarkopt_not_interested',          'Not Interested',            6, NULL, false, true,  true),
  ('remarkopt_not_connected',           'Not Connected',             7, 2,    false, false, true),
  ('remarkopt_location_issue',          'Location Issue',            8, 7,    false, false, true)
ON CONFLICT ("label") DO UPDATE SET
  "sortOrder" = EXCLUDED."sortOrder",
  "defaultDaysAhead" = EXCLUDED."defaultDaysAhead",
  "autoFlagDnc" = EXCLUDED."autoFlagDnc",
  "closesFollowup" = EXCLUDED."closesFollowup",
  "isActive" = true;
