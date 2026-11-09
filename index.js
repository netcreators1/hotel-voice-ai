import { onRequest } from "firebase-functions/v2/https";
import { app } from "./src/server.js";

// Export as 2nd Generation Cloud Function hosted in Mumbai, India (asia-south1)
export const api = onRequest(
  {
    region: "asia-south1",
    cors: true,
    maxInstances: 10,
    timeoutSeconds: 120
  },
  app
);
