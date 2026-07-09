import { createHash } from "node:crypto";
function hashPlan(planText) {
  return createHash("sha256").update(planText, "utf8").digest("hex");
}
export {
  hashPlan
};
