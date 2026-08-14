import "dotenv/config";

// Loads and validates env at process start — fails loudly (throws) rather
// than limping along with an undefined DATABASE_URL/ATLAS_API_URL, which
// would otherwise surface as a much more confusing runtime error the first
// time a request actually needs the value.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var ${name}. See backend/.env.example.`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 4800),
  databaseUrl: required("DATABASE_URL"),
  atlasApiUrl: required("ATLAS_API_URL").replace(/\/+$/, ""),
  corsOrigins: (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

if (config.isProduction && config.corsOrigins.length === 0) {
  throw new Error("CORS_ORIGIN must be set in production (comma-separated list of allowed origins).");
}
