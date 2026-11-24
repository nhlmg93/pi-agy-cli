/**
 * Effect Context service for provider configuration.
 */

import { Context, Layer } from "effect";
import type { ProviderSettings } from "./provider-env.ts";

export class ProviderConfig extends Context.Service<ProviderConfig, ProviderSettings>()(
  "pi-agy-cli/ProviderConfig",
) {}

export const makeProviderConfigLayer = (settings: ProviderSettings) =>
  Layer.succeed(ProviderConfig, settings);
