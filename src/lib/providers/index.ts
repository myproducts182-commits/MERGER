/** سجل المحولات — نقطة واحدة للوصول لأي مزود */
import type { ProviderAdapter, ProviderId } from "../types";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
};
