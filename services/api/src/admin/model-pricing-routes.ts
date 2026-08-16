import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../auth/service.js";
import { AuthenticationError } from "../auth/tokens.js";
import { AuthorizationError } from "../auth/service.js";
import type { Database } from "../db.js";
import { ModelPricingRepository } from "../model-pricing/repository.js";

export async function registerAdminModelPricingRoutes(app: FastifyInstance, auth: AuthService, database: Database): Promise<void> {
  const repo = new ModelPricingRepository(database);
  app.get("/v1/admin/model-pricing/versions", (q,r) => guard(q,r,"model_pricing.read",()=>repo.list()));
  app.get("/v1/admin/model-pricing/usage", (q,r) => guard(q,r,"model_usage.read",()=> { const x=q.query as Record<string,unknown>; const from=text(x.from); const to=text(x.to); const end=new Date(to); end.setUTCDate(end.getUTCDate()+1); return repo.usage(from,end.toISOString()); }));
  app.post("/v1/admin/model-pricing/versions", (q,r) => guard(q,r,"model_pricing.manage",async()=>r.code(201).send(await repo.create(price(q.body)))));
  app.put("/v1/admin/model-pricing/versions/:id", (q,r) => guard(q,r,"model_pricing.manage",async()=> (await repo.updateDraft(id(q),price(q.body))) ?? r.code(404).send({error:"Not found"})));
  app.post("/v1/admin/model-pricing/versions/:id/publish", (q,r) => guard(q,r,"model_pricing.manage",async()=> (await repo.publish(id(q))) ?? r.code(409).send({error:"Unavailable"})));
  app.post("/v1/admin/model-pricing/versions/:id/retire", (q,r) => guard(q,r,"model_pricing.manage",async()=> (await repo.retire(id(q),text((q.body as Record<string,unknown>)?.effectiveTo))) ?? r.code(409).send({error:"Unavailable"})));
  async function guard(q:FastifyRequest,r:any,p:any,work:()=>Promise<unknown>) { try { return await auth.requireInternalPermission(token(q),p,work); } catch(e) { if(e instanceof AuthenticationError)return r.code(401).send({error:"Authentication required"}); if(e instanceof AuthorizationError)return r.code(403).send({error:"Forbidden"}); return r.code(422).send({error:"Invalid request"}); } }
}
function token(q:FastifyRequest){const m=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(q.headers.authorization??"");if(!m)throw new AuthenticationError("Authentication required");return m[1]!;} function text(v:unknown){if(typeof v!=="string"||!v.trim()||v.length>128)throw new Error();return v.trim();} function id(q:FastifyRequest){return text((q.params as Record<string,unknown>).id);} function price(v:unknown){const x=v as Record<string,unknown>;const n=(v:unknown)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<0)throw new Error();return v;};return {provider:text(x?.provider),model:text(x?.model),inputCnyPerMillionTokens:n(x?.inputCnyPerMillionTokens),outputCnyPerMillionTokens:n(x?.outputCnyPerMillionTokens),effectiveFrom:text(x?.effectiveFrom)};}
