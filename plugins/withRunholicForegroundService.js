const {
  AndroidConfig,
  withAndroidManifest,
  createRunOncePlugin,
} = require("expo/config-plugins");

const SERVICE = "com.starbion.runholicforeground.RunTrackingService";

function withRunholicForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    app.service = app.service || [];

    const exists = app.service.some(
      (service) => service.$["android:name"] === SERVICE
    );

    if (!exists) {
      app.service.push({
        $: {
          "android:name": SERVICE,
          "android:enabled": "true",
          "android:exported": "false",
          "android:foregroundServiceType": "location",
        },
      });
    }

    return config;
  });
}

module.exports = createRunOncePlugin(
  withRunholicForegroundService,
  "withRunholicForegroundService",
  "1.0.0"
);