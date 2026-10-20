import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sathiRouter from "./sathi";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/sathi", sathiRouter);

export default router;
