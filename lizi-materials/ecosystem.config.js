
module.exports = {
  apps: [{
    name: "lizi-materials",
    script: "server.js",
    cwd: "/opt/hiubaby/lizi-materials",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      R2_PUBLIC_URL: "https://pub-2d81719a7aaf43a19e0ac4120399b44f.r2.dev",
      R2_BUCKET: "lizi-sucai",
      R2_ACCOUNT_ID: "ae5c20bd97e1d547c9913ad516ece101",
      R2_ACCESS_KEY_ID: "588443dd3da1433952bf8d7404cd1e0b",
      R2_SECRET_ACCESS_KEY: "5bb03f7d4bd5459c2518773d0884cd275c77d441b78ce5135bd13384eaaa03b5"
    }
  }]
};
