import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trakcareRouter from "./trakcare";
import cloudRouter from "./cloud";
import ktmRouter from "./ktm";
import whatsappRouter from "./whatsapp";
import outlookRouter from "./outlook";
import authRouter from "./auth";
import dataRouter from "./data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dataRouter);
router.use(trakcareRouter);
router.use(cloudRouter);
router.use(ktmRouter);
router.use(whatsappRouter);
router.use(outlookRouter);

export default router;
