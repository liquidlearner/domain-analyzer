import { router } from "../trpc";
import { customerRouter } from "./customer";
import { domainRouter } from "./domain";
import { evaluationRouter } from "./evaluation";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";

export const appRouter = router({
  customer: customerRouter,
  domain: domainRouter,
  evaluation: evaluationRouter,
  admin: adminRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
