import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
// Same-origin web app: no permissive CORS on private data.
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === "object" && error !== null && "status" in error && error.status === 413 ? 413 : 400;
  res.status(status).json({ error: status === 413 ? "This request is too large." : "The request could not be processed." });
});

export default app;
