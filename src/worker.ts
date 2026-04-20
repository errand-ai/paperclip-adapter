import { definePlugin } from "@paperclipai/plugin-sdk";

export default definePlugin({
  async setup(ctx) {
    ctx.logger.info("Errand adapter plugin started");
  },
});
