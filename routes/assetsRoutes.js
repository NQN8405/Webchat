const express = require("express");
const path = require("node:path");
const router = express.Router();
// Ánh xạ URL Bootstrap tới thư viện cài bằng npm, không cần chép vào public.
router.use("/bootstrap/css", express.static(path.join(__dirname, "../node_modules/bootstrap/dist/css")));
router.use(
  "/bootstrap-icons",
  express.static(path.join(__dirname, "../node_modules/bootstrap-icons/font")),
);
for (const directory of ["css", "js", "images"]) {
  router.use("/" + directory, express.static(path.join(__dirname, "../public", directory)));
}
// Chỉ phục vụ các thư mục tài nguyên giao diện.
module.exports = router;
