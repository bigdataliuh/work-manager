import "dotenv/config";
import cors from "cors";
import express from "express";

import { ensureSchema, getStateRecord, saveStateRecord } from "./state-repository.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const corsOrigin = process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "work-manager-api",
    time: new Date().toISOString()
  });
});

app.get("/api/state", async (_request, response, next) => {
  try {
    const record = await getStateRecord();
    response.json(record);
  } catch (error) {
    next(error);
  }
});

app.put("/api/state", async (request, response, next) => {
  try {
    const { state, baseRevision = 0 } = request.body || {};
    if (!state || typeof state !== "object") {
      response.status(400).json({ message: "Request body.state is required." });
      return;
    }

    const saved = await saveStateRecord(state, baseRevision);
    response.json(saved);
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      response.status(409).json({
        message: "State revision conflict.",
        ...error.latest
      });
      return;
    }

    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    message: "Internal server error."
  });
});

await ensureSchema();

app.listen(port, () => {
  console.log(`work-manager api listening on :${port}`);
});
