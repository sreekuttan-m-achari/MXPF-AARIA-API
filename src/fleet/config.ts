import { z } from "zod";

const EnvSchema = z.object({
  AARIA_MQTT_PROVIDER: z.string().min(1).default("hivemq"),
  AARIA_MQTT_URL: z.string().min(1),
  AARIA_MQTT_WS_URL: z.string().min(1).optional(),
  AARIA_MQTT_USERNAME: z.string().min(1),
  AARIA_MQTT_PASSWORD: z.string().min(1),
});

export type FleetMqttConfig = {
  provider: string;
  url: string;
  wsUrl?: string;
  username: string;
  password: string;
};

/** Returns null when fleet MQTT is not configured (bridge disabled). */
export function loadFleetMqttConfig(
  source: Record<string, string | undefined> = process.env,
): FleetMqttConfig | null {
  const url = source.AARIA_MQTT_URL?.trim();
  if (!url) return null;
  const parsed = EnvSchema.parse(source);
  return {
    provider: parsed.AARIA_MQTT_PROVIDER,
    url: parsed.AARIA_MQTT_URL,
    wsUrl: parsed.AARIA_MQTT_WS_URL,
    username: parsed.AARIA_MQTT_USERNAME,
    password: parsed.AARIA_MQTT_PASSWORD,
  };
}
