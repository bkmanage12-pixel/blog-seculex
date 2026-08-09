const fs = require("fs");
const path = require("path");

const outputDir = path.resolve(__dirname, "../_site");

fs.rmSync(outputDir, { recursive: true, force: true });
