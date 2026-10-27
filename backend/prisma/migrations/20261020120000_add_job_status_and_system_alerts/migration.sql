-- CreateTable
CREATE TABLE "JobStatus" (
    "job" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3) NOT NULL,
    "lastFinishedAt" TIMESTAMP(3),
    "lastOk" BOOLEAN,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastDetails" JSONB,

    CONSTRAINT "JobStatus_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "SystemAlert" (
    "condition" TEXT NOT NULL,
    "lastEmailedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("condition")
);
