import { Router, type IRouter } from "express";
import healthRouter from "./health";
import canvasRouter from "./canvas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(canvasRouter);

export default router;
