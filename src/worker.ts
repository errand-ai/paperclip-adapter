import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Errand adapter plugin started");
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
