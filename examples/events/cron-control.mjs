// Plain-JS control for diagnosing real Cron delivery independently of Wasm.
// The live fixture is internal-only and its schema is created before deployment.
export default {
  async scheduled(controller, env) {
    await env.DB.prepare("INSERT OR REPLACE INTO cron_control VALUES (?, ?)")
      .bind(controller.scheduledTime, controller.cron)
      .run();
  },
};
