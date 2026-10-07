const bcrypt = require("bcrypt");
const User = require("../models/User");
const Department = require("../models/Department");
const Major = require("../models/Major");
const StudentClass = require("../models/StudentClass");
const Channel = require("../models/Channel");
const ChannelMember = require("../models/ChannelMember");
const {
  text,
  objectId,
  requireValue,
  sameId,
  birthDate,
} = require("../services/validation");
const {
  syncClasses,
  resolveUserMembership,
  getActiveClass,
  getActiveMajor,
  classEvents,
} = require("../services/classService");

// Một bộ dữ liệu lựa chọn dùng chung cho các biểu mẫu quản trị.
async function formOptions() {
  const [departments, majors, classes, lecturers] = await Promise.all([
    Department.find().sort({ code: 1 }),
    Major.find().populate("departmentId").sort({ code: 1 }),
    StudentClass.find()
      .populate({ path: "majorId", populate: { path: "departmentId" } })
      .populate("homeroomTeacherId")
      .sort({ code: 1 }),
    User.find({ role: "lecturer" }).sort({ displayName: 1 }),
  ]);
  return { departments, majors, classes, lecturers };
}
// Tạo bộ lọc tìm kiếm; escape ký tự đặc biệt để từ khóa được hiểu như văn bản.
function searchFilter(query, fields) {
  const value = text(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = ["active", "inactive", "locked", "closed"].includes(
    query.status,
  )
    ? { status: query.status }
    : {};
  return value
    ? {
        ...filter,
        $or: fields.map((field) => ({
          [field]: { $regex: value, $options: "i" },
        })),
      }
    : filter;
}
// Gộp dữ liệu danh sách, lựa chọn biểu mẫu và bộ lọc để render trang quản trị.
async function page(req, res, view, rows, extra = {}) {
  const options = await formOptions();
  if (["users", "departments", "majors", "classes", "channels"].includes(view))
    options[view] = rows;
  const filters = { ...req.query, search: text(req.query.search) };
  if (view === "classStudents") {
    const counts = await User.aggregate([
      { $match: { role: "student" } },
      { $group: { _id: "$classId", count: { $sum: 1 } } },
    ]);
    options.classes = options.classes.map((item) => ({
      ...item.toObject(),
      studentCount: counts.find((c) => sameId(c._id, item._id))?.count || 0,
    }));
  }
  res.render("admin/" + view, { ...options, filters, ...extra });
}
async function findRecord(Model, id) {
  objectId(id, "Mã bản ghi");
  return requireValue(await Model.findById(id), "Không tìm thấy bản ghi.");
}
// Đồng bộ kênh/thành viên sau thay đổi dữ liệu rồi chuyển trang kèm thông báo.
async function finish(req, res, path, message) {
  await syncClasses();
  req.session.notice = message;
  res.redirect(path);
}
// Chuẩn hóa và kiểm tra mã, tên dùng chung cho khoa, ngành và lớp.
function catalogFields(body) {
  const code = requireValue(text(body.code).toUpperCase(), "Vui lòng nhập mã.");
  const name = requireValue(text(body.name), "Vui lòng nhập tên.");
  requireValue(code.length <= 30, "Mã không được vượt quá 30 ký tự.");
  requireValue(name.length <= 150, "Tên không được vượt quá 150 ký tự.");
  return { code, name };
}

// Quản lý khoa: xem danh sách, thêm/sửa thông tin và đổi trạng thái.
exports.getDepartments = async (req, res) =>
  page(
    req,
    res,
    "departments",
    await Department.find(searchFilter(req.query, ["code", "name"])).sort({
      code: 1,
    }),
  );
exports.saveDepartment = async (req, res) => {
  const fields = catalogFields(req.body);
  if (req.params.id) {
    const item = await findRecord(Department, req.params.id);
    Object.assign(item, fields);
    await item.save();
  } else {
    await Department.create(fields);
  }
  await finish(req, res, "/admin/departments", "Đã lưu khoa.");
};
exports.toggleDepartment = async (req, res) => {
  const item = await findRecord(Department, req.params.id);
  item.status = item.status === "active" ? "inactive" : "active";
  await item.save();
  await finish(
    req,
    res,
    "/admin/departments",
    "Đã đổi trạng thái khoa; kênh liên quan được đồng bộ.",
  );
};
// Quản lý ngành: liên kết khoa; chỉ kích hoạt ngành khi khoa đang hoạt động.
exports.getMajors = async (req, res) => {
  const filter = searchFilter(req.query, ["code", "name"]);
  if (text(req.query.departmentId))
    filter.departmentId = objectId(req.query.departmentId, "Khoa");
  await page(
    req,
    res,
    "majors",
    await Major.find(filter).populate("departmentId").sort({ code: 1 }),
  );
};
exports.saveMajor = async (req, res) => {
  const item = req.params.id
    ? await findRecord(Major, req.params.id)
    : new Major();
  const department = await findRecord(Department, text(req.body.departmentId));
  requireValue(
    department.status === "active" || sameId(item.departmentId, department),
    "Không thể chọn khoa ngừng hoạt động.",
  );
  Object.assign(item, catalogFields(req.body), {
    departmentId: department._id,
  });
  await item.save();
  await finish(req, res, "/admin/majors", "Đã lưu ngành.");
};
exports.toggleMajor = async (req, res) => {
  const item = await findRecord(Major, req.params.id);
  if (item.status !== "active")
    requireValue(
      (await Department.findById(item.departmentId))?.status === "active",
      "Cần kích hoạt khoa trước khi kích hoạt ngành.",
    );
  item.status = item.status === "active" ? "inactive" : "active";
  await item.save();
  await finish(req, res, "/admin/majors", "Đã đổi trạng thái ngành.");
};
// Quản lý lớp: liên kết ngành, phân công giảng viên chủ nhiệm và đổi trạng thái.
exports.getClasses = async (req, res) => {
  const filter = searchFilter(req.query, ["code", "name"]);
  if (text(req.query.majorId))
    filter.majorId = objectId(req.query.majorId, "Ngành");
  await page(
    req,
    res,
    "classes",
    await StudentClass.find(filter)
      .populate({ path: "majorId", populate: { path: "departmentId" } })
      .populate("homeroomTeacherId")
      .sort({ code: 1 }),
  );
};
// Có id thì cập nhật, không có id thì tạo mới; kiểm tra ngành và giảng viên trước khi lưu.
exports.saveClass = async (req, res) => {
  const item = req.params.id
    ? await findRecord(StudentClass, req.params.id)
    : new StudentClass();
  const majorId = objectId(text(req.body.majorId), "Ngành");
  if (!sameId(item.majorId, majorId)) await getActiveMajor(majorId);
  else
    requireValue(await Major.exists({ _id: majorId }), "Ngành không tồn tại.");
  const teacherId = text(req.body.homeroomTeacherId);
  if (teacherId) {
    objectId(teacherId, "Giảng viên");
    requireValue(
      await User.exists({
        _id: teacherId,
        role: "lecturer",
        ...(sameId(item.homeroomTeacherId, teacherId)
          ? {}
          : { status: "active" }),
      }),
      "Giảng viên không hoạt động.",
    );
  }
  Object.assign(item, catalogFields(req.body), {
    majorId,
    homeroomTeacherId: teacherId || undefined,
  });
  await item.save();
  await finish(req, res, "/admin/classes", "Đã lưu lớp và đồng bộ kênh chung.");
};
exports.toggleClass = async (req, res) => {
  const item = await findRecord(StudentClass, req.params.id);
  if (item.status !== "active") await getActiveMajor(String(item.majorId));
  item.status = item.status === "active" ? "inactive" : "active";
  await item.save();
  await finish(
    req,
    res,
    "/admin/classes",
    "Đã đổi trạng thái lớp. Kích hoạt lớp không tự mở lại kênh.",
  );
};

// Quản lý tài khoản: tìm kiếm, lọc vai trò/khoa/lớp/trạng thái và hiển thị danh sách.
exports.getUsers = async (req, res) => {
  const filter = searchFilter(req.query, ["username", "displayName"]);
  if (["student", "lecturer", "admin"].includes(req.query.role))
    filter.role = req.query.role;
  for (const key of ["departmentId", "classId"])
    if (text(req.query[key])) filter[key] = objectId(req.query[key], key);
  await page(
    req,
    res,
    "users",
    await User.find(filter)
      .populate("departmentId")
      .populate("classId")
      .sort({ username: 1 }),
  );
};
// Tạo hoặc sửa tài khoản; xác định khoa/lớp theo vai trò và bảo vệ quyền admin hiện tại.
exports.saveUser = async (req, res) => {
  const item = req.params.id
    ? await findRecord(User, req.params.id)
    : new User();
  const role = text(req.body.role);
  requireValue(
    ["admin", "lecturer", "student"].includes(role),
    "Vai trò không hợp lệ.",
  );
  if (item.id === req.session.user.id)
    requireValue(role === "admin", "Không thể tự bỏ quyền quản trị.");
  if (item.role === "lecturer" && role !== "lecturer")
    requireValue(
      !(await StudentClass.exists({ homeroomTeacherId: item._id })),
      "Hãy thay giảng viên chủ nhiệm trước khi đổi vai trò.",
    );
  const membership = await resolveUserMembership(
    {
      role,
      classId: text(req.body.classId),
      departmentId: text(req.body.departmentId),
    },
    item,
  );
  const dateOfBirth = birthDate(req.body.birthDate);
  // Tài khoản mới dùng ddMMyyyy; sửa ngày sinh không làm đổi mật khẩu hiện tại.
  const initialPassword = req.body.birthDate.split("-").reverse().join("");
  const password = item.isNew
    ? initialPassword
    : typeof req.body.password === "string"
      ? req.body.password
      : "";
  if (item.isNew || password) {
    requireValue(
      password.length >= 6 && Buffer.byteLength(password) <= 72,
      "Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte.",
    );
    item.hashedPassword = await bcrypt.hash(password, 10);
  }
  const username = text(req.body.username);
  const displayName = text(req.body.displayName);
  requireValue(
    username && username.length <= 80,
    "Tên đăng nhập cần từ 1 đến 80 ký tự.",
  );
  requireValue(
    displayName && displayName.length <= 100,
    "Tên hiển thị cần từ 1 đến 100 ký tự.",
  );
  Object.assign(item, membership, {
    role,
    birthDate: dateOfBirth,
    username,
    displayName,
  });
  await item.save();
  await finish(req, res, "/admin/users", "Đã lưu tài khoản.");
};
exports.toggleUser = async (req, res) => {
  const item = await findRecord(User, req.params.id);
  requireValue(
    item.id !== req.session.user.id,
    "Không thể khóa tài khoản đang đăng nhập.",
  );
  item.status = item.status === "active" ? "locked" : "active";
  await item.save();
  await finish(req, res, "/admin/users", "Đã đổi trạng thái tài khoản.");
};
// Tách sinh viên trong lớp và sinh viên chưa xếp lớp để hiển thị biểu mẫu phân lớp.
exports.getClassStudents = async (req, res) => {
  const classId = text(req.query.classId);
  let selectedClass = null,
    students = [],
    availableStudents = [];
  if (classId) {
    selectedClass = await findRecord(StudentClass, classId);
    [students, availableStudents] = await Promise.all([
      User.find({ role: "student", classId }).sort({ displayName: 1 }),
      User.find({ role: "student", status: "active", classId: null }).sort({
        displayName: 1,
      }),
    ]);
  }
  await page(
    req,
    res,
    selectedClass ? "classStudentsDetail" : "classStudents",
    students,
    {
      selectedClass,
      assignedStudents: students,
      availableStudents,
    },
  );
};
// Kiểm tra danh sách chọn, cập nhật lớp/khoa rồi đồng bộ lại quyền chat.
exports.assignStudents = async (req, res) => {
  const item = await getActiveClass(text(req.body.classId));
  const rawIds = Array.isArray(req.body.studentIds)
    ? req.body.studentIds
    : [req.body.studentIds];
  const ids = [
    ...new Set(rawIds.filter(Boolean).map((id) => objectId(id, "Sinh viên"))),
  ];
  requireValue(ids.length > 0, "Chọn ít nhất một sinh viên.");
  requireValue(
    (await User.countDocuments({
      _id: { $in: ids },
      role: "student",
      status: "active",
    })) === ids.length,
    "Danh sách có sinh viên không hợp lệ; chưa chuyển lớp.",
  );
  await User.updateMany(
    { _id: { $in: ids } },
    {
      $set: { classId: item._id, departmentId: item.majorId.departmentId._id },
    },
  );
  await finish(
    req,
    res,
    "/admin/class-students?classId=" + item.id,
    "Đã phân/chuyển sinh viên và cập nhật quyền chat.",
  );
};
// Bỏ liên kết lớp của sinh viên; đồng bộ thành viên kênh, không xóa lịch sử tin nhắn.
exports.removeStudent = async (req, res) => {
  const classId = objectId(text(req.body.classId), "Lớp");
  const student = await findRecord(User, req.params.id);
  requireValue(
    student.role === "student" && sameId(student.classId, classId),
    "Sinh viên không thuộc lớp này.",
  );
  student.classId = undefined;
  await student.save();
  await finish(
    req,
    res,
    "/admin/class-students?classId=" + classId,
    "Đã bỏ sinh viên khỏi lớp; giữ nguyên lịch sử tin nhắn.",
  );
};
// Quản lý kênh chung: lọc danh sách, đếm thành viên, đổi tên và đóng/mở kênh.
exports.getChannels = async (req, res) => {
  const filter = { type: "class", ...searchFilter(req.query, ["name"]) };
  if (text(req.query.classId))
    filter.classId = objectId(req.query.classId, "Lớp");
  const rows = await Channel.find(filter)
    .populate("classId")
    .sort({ createdAt: -1 });
  const counts = await ChannelMember.aggregate([
    { $group: { _id: "$channelId", count: { $sum: 1 } } },
  ]);
  await page(req, res, "channels", rows, {
    countMap: Object.fromEntries(
      counts.map((item) => [String(item._id), item.count]),
    ),
  });
};
exports.saveChannel = async (req, res) => {
  const item = await findRecord(Channel, req.params.id);
  requireValue(item.type === "class", "Kênh nằm ngoài phạm vi hiện tại.");
  const name = requireValue(text(req.body.name), "Vui lòng nhập tên kênh.");
  requireValue(name.length <= 150, "Tên kênh không được vượt quá 150 ký tự.");
  item.name = name;
  await item.save();
  req.session.notice = "Đã cập nhật kênh.";
  res.redirect("/admin/channels");
};
exports.toggleChannel = async (req, res) => {
  const item = await findRecord(Channel, req.params.id);
  requireValue(item.type === "class", "Kênh nằm ngoài phạm vi hiện tại.");
  if (item.status === "closed") await getActiveClass(String(item.classId));
  item.status = item.status === "active" ? "closed" : "active";
  item.closedAt = item.status === "closed" ? new Date() : undefined;
  await item.save();
  // Báo cho Socket.IO ngay sau khi lưu, kể cả khi không thay danh sách thành viên.
  classEvents.emit("changed");
  req.session.notice = "Đã đổi trạng thái kênh; lịch sử được giữ nguyên.";
  res.redirect("/admin/channels");
};
