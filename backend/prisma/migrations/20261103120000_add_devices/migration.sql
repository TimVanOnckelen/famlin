CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "appBuild" TEXT NOT NULL,
    "pushPermission" TEXT NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Device_installId_key" ON "Device"("installId");
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

ALTER TABLE "PushToken" ADD COLUMN "deviceId" TEXT;
CREATE INDEX "PushToken_deviceId_idx" ON "PushToken"("deviceId");

ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
