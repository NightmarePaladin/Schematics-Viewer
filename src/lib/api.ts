import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const forbidden = (msg = "You do not have permission to do that.") => new ApiError(403, "forbidden", msg);
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/** Convert a Supabase/PostgREST/Postgres error into a meaningful ApiError. */
export function fromDbError(err: PgLikeError, fallbackMsg = "Database request failed."): ApiError {
  switch (err.code) {
    case "23505":
      return new ApiError(409, "conflict", describeUnique(err) ?? "That record already exists.");
    case "23503":
      return new ApiError(409, "invalid_reference", "A referenced record does not exist or belongs to another organization.");
    case "23514":
    case "22P02":
    case "22003":
      return new ApiError(422, "invalid_value", err.message ?? "A value is out of range.");
    case "P0001":
      return new ApiError(409, "conflict", err.message ?? "That change is not allowed.");
    case "42501":
      return new ApiError(403, "forbidden", "You do not have permission to do that.");
    case "PGRST116":
      return notFound();
    default:
      // never shown to the client in production, but always visible in the server logs so failures can be diagnosed
      console.error("[db_error]", err.code ?? "", err.message ?? "", err.details ?? "");
      return new ApiError(500, "db_error", fallbackMsg, process.env.NODE_ENV === "production" ? undefined : err.message);
  }
}

function describeUnique(err: PgLikeError): string | null {
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  if (text.includes("machines_serial_scope_key"))
    return "A machine with this manufacturer and serial number already exists in your organization.";
  if (text.includes("schematics_machine_id_document_number_revision_key"))
    return "This machine already has a schematic with that document number and revision.";
  if (text.includes("grants_")) return "That user or group already has a grant on this schematic. Update it instead.";
  return null;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Some fields are invalid.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  console.error("Unhandled API error", err);
  return NextResponse.json({ error: { code: "internal", message: "Unexpected server error." } }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const obj = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(obj);
}

/** Throw if a PostgREST response carries an error. */
export function check<T>(res: { data: T; error: PgLikeError | null }): NonNullable<T> {
  if (res.error) throw fromDbError(res.error);
  if (res.data === null || res.data === undefined) throw notFound();
  return res.data as NonNullable<T>;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a Route Handler so thrown ApiErrors/ZodErrors become JSON errors with the right status. */
export function handler<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
