import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../auth/service.js";
import { AuthenticationError } from "../auth/tokens.js";
import { AuthorizationError } from "../auth/service.js";
import type { Database } from "../db.js";
import { ModelPricingRepository } from "../model-pricing/repository.js";
export class PricingValidationError extends Error {}

export async function registerAdminModelPricingRoutes(app: FastifyInstance, auth: AuthService, database: Database): Promise<void> {
  const repo = new ModelPricingRepository(database);
  app.get("/v1/admin/model-pricing/versions", (q,r) => guard(q,r,"model_pricing.read",async()=>({items:await repo.list()})));
  app.get("/v1/admin/model-pricing/usage", (q,r) => guard(q,r,"model_usage.read",async()=> { const x=q.query as Record<string,unknown>; const range=usageRange(x.from,x.to); return { items: await repo.usage(range.from,range.toExclusive) }; }));
  app.post("/v1/admin/model-pricing/versions", (q,r) => guard(q,r,"model_pricing.manage",async actor=>r.code(201).send(await repo.createAndAudit(actor.id,price(q.body)) )));
  app.put("/v1/admin/model-pricing/versions/:id", (q,r) => guard(q,r,"model_pricing.manage",async actor=>{const item=await repo.updateDraftAndAudit(actor.id,id(q),price(q.body));return item ?? r.code(404).send({error:"Not found"});}));
  app.post("/v1/admin/model-pricing/versions/:id/publish", (q,r) => guard(q,r,"model_pricing.manage",async actor=>{const item=await repo.publishAndAudit(actor.id,id(q));return item ?? r.code(409).send({error:"Unavailable"});}));
  app.post("/v1/admin/model-pricing/versions/:id/retire", (q,r) => guard(q,r,"model_pricing.manage",async actor=>{const item=await repo.retireAndAudit(actor.id,id(q),text((q.body as Record<string,unknown>)?.effectiveTo));return item ?? r.code(409).send({error:"Unavailable"});}));
  async function guard(q:FastifyRequest,r:any,p:any,work:(actor:{id:string;displayName:string})=>Promise<unknown>) { try { return await auth.requireInternalPermission(token(q),p,work); } catch(e) { if(e instanceof AuthenticationError)return r.code(401).send({error:"Authentication required"}); if(e instanceof AuthorizationError)return r.code(403).send({error:"Forbidden"}); if(e instanceof PricingValidationError)return r.code(422).send({error:"Invalid request"}); throw e; } }
}
function token(q:FastifyRequest){const m=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(q.headers.authorization??"");if(!m)throw new AuthenticationError("Authentication required");return m[1]!;} function text(v:unknown){if(typeof v!=="string"||!v.trim()||v.length>128)throw new PricingValidationError();return v.trim();} function id(q:FastifyRequest){return text((q.params as Record<string,unknown>).id);} function price(v:unknown){const x=v as Record<string,unknown>;const n=(v:unknown)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<0)throw new PricingValidationError();return v;};return {provider:text(x?.provider),model:text(x?.model),inputCnyPerMillionTokens:n(x?.inputCnyPerMillionTokens),outputCnyPerMillionTokens:n(x?.outputCnyPerMillionTokens),effectiveFrom:text(x?.effectiveFrom)};}
function usageRange(from: unknown, to: unknown) { if (from === undefined && to === undefined) { const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30); return { from: start.toISOString(), toExclusive: end.toISOString() }; } const start = new Date(text(from)); const end = new Date(text(to)); if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) throw new PricingValidationError(); end.setUTCDate(end.getUTCDate() + 1); return { from: start.toISOString(), toExclusive: end.toISOString() }; }
