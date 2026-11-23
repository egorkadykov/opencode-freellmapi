import { Model, Plugin, Provider } from "@opencode/plugin";
import { fetchModels } from "./models.js";

const PROVIDER_ID = "freellmapi";
const PROVIDER_NAME = "FreeLLMAPI";
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

function displayName(model) {
  if (model.available) return model.name;
  if (model.reason === "no_key") return `${model.name} — no provider key`;
  return `${model.name} — unavailable`;
}

function toModelInfos(models) {
  const providerID = Provider.ID.make(PROVIDER_ID);
  return models.map((model) => ({
    ...Model.Info.default(providerID, Model.ID.make(model.id)),
    name: displayName(model),
    limit: { context: model.context, output: model.output },
  }));
}

function readOptions(ctx) {
  const options = ctx.options ?? {};
  return {
    baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
    apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
    includeUnavailable: options.includeUnavailable !== false,
  };
}

export default Plugin.define({
  id: "freellmapi",
  async setup(ctx) {
    const { baseURL, apiKey, includeUnavailable } = readOptions(ctx);
    if (!baseURL || !apiKey) {
      console.warn(
        "[freellmapi] baseURL and apiKey are required in the plugin options; model sync skipped",
      );
      return;
    }

    // `models.set` replaces the provider's source inventory, so the captured
    // array is re-read every time the provider domain replays its transforms.
    const state = { infos: [], unavailable: 0 };

    const load = async () => {
      const discovered = await fetchModels(baseURL, apiKey, { includeUnavailable });
      if (!discovered.length) return false;
      state.infos = toModelInfos(discovered);
      state.unavailable = discovered.filter((model) => !model.available).length;
      return true;
    };

    if (!(await load())) {
      console.warn(`[freellmapi] ${baseURL} returned no models; model sync skipped`);
      return;
    }

    console.warn(
      `[freellmapi] synced ${state.infos.length} models` +
        (state.unavailable ? ` (${state.unavailable} without a provider key in the router)` : ""),
    );

    const providerID = Provider.ID.make(PROVIDER_ID);

    await ctx.provider.transform((editor) => {
      if (editor.get(PROVIDER_ID)) {
        editor.models.set(PROVIDER_ID, state.infos);
        return;
      }
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: PROVIDER_NAME,
          activation: "enabled",
          package: PROVIDER_PACKAGE,
          settings: { baseURL, apiKey },
        },
        models: state.infos,
      });
    });

    const refreshMinutes = Number(ctx.options?.refreshMinutes);
    const refreshMs =
      Number.isFinite(refreshMinutes) && refreshMinutes > 0
        ? refreshMinutes * 60 * 1000
        : DEFAULT_REFRESH_MS;

    const timer = setInterval(() => {
      void (async () => {
        try {
          if (await load()) await ctx.provider.reload();
        } catch (error) {
          console.warn(`[freellmapi] model refresh failed: ${error?.message ?? error}`);
        }
      })();
    }, refreshMs);

    if (typeof timer?.unref === "function") timer.unref();

    return () => clearInterval(timer);
  },
});
