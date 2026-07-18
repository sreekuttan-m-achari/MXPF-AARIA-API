import { z } from "zod";

export const FleetEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1),
  id: z.string().min(1),
  ts: z.string().min(1),
  agentId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type FleetEnvelope = z.infer<typeof FleetEnvelopeSchema>;

export function parseEnvelope(raw: string | Buffer): FleetEnvelope {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  return FleetEnvelopeSchema.parse(JSON.parse(text));
}

export function serializeEnvelope(env: FleetEnvelope): string {
  return JSON.stringify(FleetEnvelopeSchema.parse(env));
}

export function makeEnvelope(
  type: string,
  agentId: string,
  payload: Record<string, unknown>,
  id: string = crypto.randomUUID(),
): FleetEnvelope {
  return {
    v: 1,
    type,
    id,
    ts: new Date().toISOString(),
    agentId,
    payload,
  };
}
