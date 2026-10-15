import { z } from "zod";

const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : v),
    z.coerce.number().min(min).max(max).nullable(),
  );

export const MACHINE_STATUSES = ["operational", "degraded", "down", "maintenance", "retired"] as const;
export const ISSUE_STATUSES = ["open", "in_progress", "resolved"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ANNOTATION_TYPES = ["point", "comment", "box", "callout"] as const;
export const LOG_TYPES = ["inspection", "repair", "calibration", "note"] as const;

/** Fields without defaults: safe to `.partial()` for updates (a default would silently overwrite stored values). */
const machineFields = z.object({
  name: trimmed(120),
  category: trimmed(80),
  manufacturer: trimmed(120),
  model_number: trimmed(80),
  serial_number: trimmed(80),
  asset_number: optionalText(80),
  description: optionalText(2000),
  location: optionalText(200),
  latitude: optionalNumber(-90, 90),
  longitude: optionalNumber(-180, 180),
  installed_on: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
    ),
  status: z.enum(MACHINE_STATUSES),
  /** Optional parent system/machine this one is a sub-part of. */
  parent_id: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()),
  /** Critical component: a major unresolved issue here makes the parent inoperable until resolved. */
  is_critical: z.boolean(),
});

const latLonPair = (m: { latitude: number | null; longitude: number | null }, ctx: z.RefinementCtx) => {
  if ((m.latitude === null) !== (m.longitude === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "Provide both latitude and longitude, or neither",
    });
  }
};

export const machineCreateSchema = machineFields
  .extend({
    status: machineFields.shape.status.default("operational"),
    is_critical: machineFields.shape.is_critical.default(false),
  })
  .superRefine(latLonPair);

export const machineUpdateSchema = machineFields.partial().superRefine((m, ctx) => {
  if ((m.latitude === undefined) !== (m.longitude === undefined)) {
    ctx.addIssue({ code: "custom", path: ["latitude"], message: "Send latitude and longitude together" });
    return;
  }
  if (m.latitude !== undefined && m.longitude !== undefined) latLonPair(
    { latitude: m.latitude, longitude: m.longitude },
    ctx,
  );
});

/** "Major" issues: unresolved issues with these severities take a critical component's parent out of service. */
export const MAJOR_SEVERITIES = ["high", "critical"] as const;

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const schematicMetaSchema = z.object({
  machine_id: z.string().uuid(),
  title: trimmed(160),
  document_number: trimmed(80),
  revision: trimmed(20),
});

export const schematicUpdateSchema = schematicMetaSchema.omit({ machine_id: true }).partial();

const norm = z.number().min(0).max(1);

export const annotationCreateSchema = z
  .object({
    schematic_id: z.string().uuid(),
    page_number: z.number().int().min(1),
    type: z.enum(ANNOTATION_TYPES),
    x: norm,
    y: norm,
    width: norm.nullish(),
    height: norm.nullish(),
    body: z.string().trim().max(4000).default(""),
    status: z.enum(ISSUE_STATUSES).nullish(),
  })
  .superRefine((a, ctx) => {
    const needsSize = a.type === "box" || a.type === "callout";
    if (needsSize) {
      if (!a.width || !a.height || a.width <= 0 || a.height <= 0) {
        ctx.addIssue({ code: "custom", path: ["width"], message: `${a.type} needs positive width and height` });
      } else if (a.x + a.width > 1 + 1e-9 || a.y + a.height > 1 + 1e-9) {
        ctx.addIssue({ code: "custom", path: ["width"], message: "Rectangle must stay inside the page" });
      }
    } else if (a.width != null || a.height != null) {
      ctx.addIssue({ code: "custom", path: ["width"], message: `${a.type} annotations have no size` });
    }
    if ((a.type === "comment" || a.type === "callout") && a.body.length === 0) {
      ctx.addIssue({ code: "custom", path: ["body"], message: `${a.type} needs text` });
    }
  });

export const annotationUpdateSchema = z.object({
  body: z.string().trim().max(4000).optional(),
  status: z.enum(ISSUE_STATUSES).nullable().optional(),
  x: norm.optional(),
  y: norm.optional(),
  width: norm.optional(),
  height: norm.optional(),
});

export const replyCreateSchema = z.object({
  body: trimmed(4000),
  is_resolution_note: z.boolean().default(false),
});

export const issueCreateSchema = z.object({
  machine_id: z.string().uuid(),
  schematic_id: z.string().uuid().nullish(),
  annotation_id: z.string().uuid().nullish(),
  page_number: z.number().int().min(1).nullish(),
  title: trimmed(160),
  description: z.string().trim().max(4000).default(""),
  severity: z.enum(SEVERITIES).default("medium"),
  assignee_id: z.string().uuid().nullish(),
});

export const issueUpdateSchema = z.object({
  title: trimmed(160).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  resolution_note: z.string().trim().max(4000).nullable().optional(),
});

export const logCreateSchema = z.object({
  machine_id: z.string().uuid(),
  issue_id: z.string().uuid().nullish(),
  schematic_id: z.string().uuid().nullish(),
  annotation_id: z.string().uuid().nullish(),
  entry_type: z.enum(LOG_TYPES).default("note"),
  body: trimmed(4000),
  performed_at: z.string().datetime({ offset: true }).optional(),
});

export const grantCreateSchema = z
  .object({
    user_id: z.string().uuid().nullish(),
    group_id: z.string().uuid().nullish(),
    level: z.enum(["view", "comment", "edit", "manage"]),
  })
  .refine((g) => Boolean(g.user_id) !== Boolean(g.group_id), {
    message: "Provide exactly one of user_id or group_id",
  });

export const groupCreateSchema = z.object({
  name: trimmed(80),
  description: optionalText(300),
});

export const orgCreateSchema = z.object({ name: trimmed(80) });

export const memberAddSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "maintenance_manager", "technician", "viewer"]),
});

export const groupMemberSchema = z.object({ user_id: z.string().uuid() });

export type MachineInput = z.infer<typeof machineCreateSchema>;
export type AnnotationInput = z.infer<typeof annotationCreateSchema>;
