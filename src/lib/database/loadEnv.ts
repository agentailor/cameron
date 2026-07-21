import { config as loadEnv } from "dotenv";

// Side-effecting env loader for scripts that run outside Next (via tsx), e.g. `db:seed`.
loadEnv({ path: [".env.local", ".env"] });
