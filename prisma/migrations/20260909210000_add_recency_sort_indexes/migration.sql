-- Supports the Registered and Booked (type) tabs' newest-first sort
-- (getTodayFollowups in src/lib/followups.ts), which groups Registration/
-- Booking rows per customer and orders by the most recent date. Purely
-- additive: does not change any existing data or query behavior on its own.

-- CreateIndex
CREATE INDEX "Registration_customerId_onboardingDate_idx" ON "Registration"("customerId", "onboardingDate");

-- CreateIndex
CREATE INDEX "Booking_customerId_bookingDate_idx" ON "Booking"("customerId", "bookingDate");
