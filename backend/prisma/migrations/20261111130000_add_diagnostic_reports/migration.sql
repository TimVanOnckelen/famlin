CREATE TABLE "DiagnosticReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagnosticReport_createdAt_idx" ON "DiagnosticReport"("createdAt");
CREATE INDEX "DiagnosticReport_userId_idx" ON "DiagnosticReport"("userId");

ALTER TABLE "DiagnosticReport" ADD CONSTRAINT "DiagnosticReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
