const { createApp } = require("./app");

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`zpay-endpoint-hardening listening on port ${PORT}`);
});
