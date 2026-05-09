-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServerSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "serverAddress" TEXT NOT NULL,
    "serverPort" INTEGER NOT NULL DEFAULT 8443,
    "agentKeyHash" TEXT NOT NULL,
    "ipListMode" TEXT NOT NULL DEFAULT 'ALLOW_ALL_BLOCKLIST',
    "ipAllowlist" TEXT NOT NULL DEFAULT '[]',
    "ipBlocklist" TEXT NOT NULL DEFAULT '[]',
    "publicReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AlertSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "alertLevel" TEXT NOT NULL DEFAULT 'DOWN',
    "repeat" TEXT NOT NULL DEFAULT 'STATUS_CHANGE_ONLY',
    "delaySeconds" INTEGER NOT NULL DEFAULT 60,
    "upDownWarningCycles" INTEGER NOT NULL DEFAULT 2,
    "upDownDownCycles" INTEGER NOT NULL DEFAULT 4,
    "latencyCycles" INTEGER NOT NULL DEFAULT 3,
    "latencyWarningMs" INTEGER NOT NULL DEFAULT 250,
    "latencyDownMs" INTEGER NOT NULL DEFAULT 1000,
    "sslWarningDays" INTEGER NOT NULL DEFAULT 30,
    "sslDownDays" INTEGER NOT NULL DEFAULT 7,
    "httpCycles" INTEGER NOT NULL DEFAULT 3,
    "webhookUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "sourceIp" TEXT,
    "lastCheckIn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "friendlyName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "overrideSettings" TEXT,
    "expectedResponse" TEXT,
    "proposedResponse" TEXT,
    "parentAgentId" TEXT NOT NULL,
    "parentMonitorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Monitor_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Monitor_parentMonitorId_fkey" FOREIGN KEY ("parentMonitorId") REFERENCES "Monitor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonitorDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentMonitorId" TEXT NOT NULL,
    "childMonitorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonitorDependency_parentMonitorId_fkey" FOREIGN KEY ("parentMonitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MonitorDependency_childMonitorId_fkey" FOREIGN KEY ("childMonitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonitorCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "sslValid" BOOLEAN,
    "sslExpiresAt" DATETIME,
    "sslSelfSigned" BOOLEAN,
    "httpMatched" BOOLEAN,
    "httpStatusCode" INTEGER,
    "message" TEXT,
    "rawDetails" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonitorCheck_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "message" TEXT,
    "suppressedByMonitorId" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "notificationError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertEvent_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorDependency_parentMonitorId_childMonitorId_key" ON "MonitorDependency"("parentMonitorId", "childMonitorId");

-- CreateIndex
CREATE INDEX "MonitorCheck_monitorId_checkedAt_idx" ON "MonitorCheck"("monitorId", "checkedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_monitorId_createdAt_idx" ON "AlertEvent"("monitorId", "createdAt");
