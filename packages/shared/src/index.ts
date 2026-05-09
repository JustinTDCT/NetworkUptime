import { URL } from "node:url";
import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const ipListModeSchema = z.enum(["allow_all_blocklist", "allow_none_whitelist"]);
export type IpListMode = z.infer<typeof ipListModeSchema>;

export const monitorTypeSchema = z.enum(["ssl", "up_down", "http_https"]);
export type MonitorType = z.infer<typeof monitorTypeSchema>;

export const monitorStatusSchema = z.enum(["unknown", "up", "warning", "down", "suppressed"]);
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;

export const alertLevelSchema = z.enum(["warning", "down"]);
export type AlertLevel = z.infer<typeof alertLevelSchema>;

export const alertRepeatSchema = z.enum(["none", "always", "status_change_only"]);
export type AlertRepeat = z.infer<typeof alertRepeatSchema>;

export const passwordPolicySchema = z
  .string()
  .min(12)
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS.");

export const serverSettingsSchema = z.object({
  serverAddress: httpsUrlSchema,
  serverPort: z.coerce.number().int().min(1).max(65535).default(8443),
  agentKey: uuidSchema,
  ipListMode: ipListModeSchema.default("allow_all_blocklist"),
  ipAllowlist: z.array(z.string().min(1)).default([]),
  ipBlocklist: z.array(z.string().min(1)).default([]),
  publicReadOnly: z.coerce.boolean().default(false)
});
export type ServerSettingsInput = z.infer<typeof serverSettingsSchema>;

export const agentConfigSchema = z.object({
  name: z.string().min(1).max(120),
  id: uuidSchema.optional(),
  description: z.string().max(1000).default(""),
  serverUrl: z.string().url(),
  serverKey: uuidSchema,
  allowInsecureLocalhost: z.coerce.boolean().default(false)
}).superRefine((value, context) => {
  const url = new URL(value.serverUrl);
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol === "https:") {
    return;
  }

  if (value.allowInsecureLocalhost && url.protocol === "http:" && isLocalhost) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["serverUrl"],
    message: "Server URL must use HTTPS unless insecure localhost mode is enabled."
  });
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const userCreateSchema = z.object({
  fullName: z.string().min(1).max(160),
  username: z.string().min(3).max(80),
  email: z.string().email(),
  password: passwordPolicySchema
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerAgentSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  version: z.string().max(80).default("0.1.0")
});
export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;

export const agentCheckInSchema = z.object({
  version: z.string().max(80).default("0.1.0"),
  observedAt: z.string().datetime().optional()
});
export type AgentCheckInInput = z.infer<typeof agentCheckInSchema>;

export const alertSettingsSchema = z.object({
  alertLevel: alertLevelSchema.default("down"),
  repeat: alertRepeatSchema.default("status_change_only"),
  delaySeconds: z.coerce.number().int().min(5).default(60),
  upDownWarningCycles: z.coerce.number().int().min(1).default(2),
  upDownDownCycles: z.coerce.number().int().min(1).default(4),
  latencyCycles: z.coerce.number().int().min(1).default(3),
  latencyWarningMs: z.coerce.number().int().min(1).default(250),
  latencyDownMs: z.coerce.number().int().min(1).default(1000),
  sslWarningDays: z.coerce.number().int().min(0).default(30),
  sslDownDays: z.coerce.number().int().min(0).default(7),
  httpCycles: z.coerce.number().int().min(1).default(3),
  webhookUrl: z.union([z.string().url(), z.literal("")]).optional().transform((value) => value || undefined)
});
export type AlertSettingsInput = z.infer<typeof alertSettingsSchema>;

export const monitorSchema = z.object({
  friendlyName: z.string().min(1).max(160),
  description: z.string().max(1000).default(""),
  parentAgentId: uuidSchema,
  parentMonitorId: z
    .union([uuidSchema, z.literal("")])
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  target: z.string().min(1).max(2048),
  type: monitorTypeSchema,
  overrideSettings: alertSettingsSchema.partial().optional()
});
export type MonitorInput = z.infer<typeof monitorSchema>;

export const monitorCheckResultSchema = z.object({
  monitorId: uuidSchema,
  status: z.enum(["up", "warning", "down"]),
  latencyMs: z.coerce.number().int().min(0).optional(),
  sslValid: z.boolean().optional(),
  sslExpiresAt: z.string().datetime().optional(),
  sslSelfSigned: z.boolean().optional(),
  message: z.string().max(1000).optional(),
  rawDetails: z.record(z.string(), z.unknown()).optional()
});
export type MonitorCheckResultInput = z.infer<typeof monitorCheckResultSchema>;

export const bearerToken = (authorization: string | undefined): string | undefined => {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
};
