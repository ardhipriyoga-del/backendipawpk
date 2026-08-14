import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
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
app.use(cors());
app.use(cookieParser());
// Cloud backup sends the complete IndexedDB snapshot in one request. The
// default Express JSON limit (100 KB) is too small for a real patient history,
// especially when activity logs and handover records are included.
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.use("/api", router);

app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    res.status(413).json({
      error: "Payload backup terlalu besar. Kurangi lampiran/log lalu ulangi backup.",
    });
    return;
  }
  next(error);
});

export default app;
