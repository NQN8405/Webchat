const User = require("../models/User");
const Department = require("../models/Department");
const Major = require("../models/Major");
const StudentClass = require("../models/StudentClass");
const Channel = require("../models/Channel");
const ChannelMember = require("../models/ChannelMember");
const { EventEmitter } = require("node:events");
const { objectId, requireValue } = require("./validation");
// Thông báo cho Socket.IO kiểm tra lại quyền khi dữ liệu lớp hoặc tài khoản thay đổi.
const classEvents = new EventEmitter();
let syncQueue = Promise.resolve();

// Lấy lớp cùng ngành/khoa để kiểm tra quan hệ và trạng thái hoạt động.
async function getClass(classId) {
  objectId(classId, "Lớp");
  const item = await StudentClass.findById(classId).populate({
    path: "majorId",
    populate: { path: "departmentId" },
  });
  requireValue(item, "Lớp không tồn tại.");
  return item;
}
// Lớp chỉ cho phép hoạt động khi cả lớp, ngành và khoa đều active.
function isClassActive(item) {
  return (
    item?.status === "active" &&
    item.majorId?.status === "active" &&
    item.majorId?.departmentId?.status === "active"
  );
}
async function getActiveClass(classId) {
  const item = await getClass(classId);
  requireValue(isClassActive(item), "Lớp, ngành hoặc khoa đã ngừng hoạt động.");
  return item;
}
async function getActiveMajor(majorId) {
  objectId(majorId, "Ngành");
  const item = await Major.findById(majorId).populate("departmentId");
  requireValue(
    item?.status === "active" && item.departmentId?.status === "active",
    "Ngành hoặc khoa không hoạt động.",
  );
  return item;
}
// Sinh viên có lớp lấy khoa theo lớp; các tài khoản còn lại dùng khoa được chọn.
async function resolveUserMembership(body, existing) {
  if (body.role === "student" && body.classId) {
    const item = await getClass(body.classId);
    const keepingClass =
      existing?.role === "student" && String(existing.classId) === String(item._id);
    requireValue(keepingClass || isClassActive(item), "Không thể phân vào lớp đã ngừng hoạt động.");
    return { classId: item._id, departmentId: item.majorId?.departmentId?._id };
  }
  if (body.departmentId) {
    objectId(body.departmentId, "Khoa");
    const department = await Department.findById(body.departmentId);
    requireValue(
      department &&
        (department.status === "active" || String(existing?.departmentId) === department.id),
      "Khoa không hoạt động.",
    );
    return { classId: undefined, departmentId: department._id };
  }
  return { classId: undefined, departmentId: undefined };
}

// Tạo một kênh mỗi lớp và tính lại thành viên từ dữ liệu lớp hiện tại.
async function synchronizeClasses() {
  await Promise.all([StudentClass.init(), Channel.init(), ChannelMember.init()]);
  const classes = await StudentClass.find().populate({
    path: "majorId",
    populate: { path: "departmentId" },
  });
  for (const item of classes) {
    const active = isClassActive(item);
    // Chỉ tạo kênh nếu chưa có; giữ tên và trạng thái của kênh đã được quản trị viên chỉnh.
    const channel = await Channel.findOneAndUpdate(
      { classId: item._id, type: "class" },
      {
        $setOnInsert: {
          classId: item._id,
          type: "class",
          name: "Chat chung " + item.code,
          description: "Trao đổi của lớp " + item.name,
          status: active ? "active" : "closed",
          ...(active ? {} : { closedAt: new Date() }),
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
    if (!active && channel.status === "active") {
      channel.status = "closed";
      channel.closedAt = new Date();
      await channel.save();
    }
    if (item.majorId?.departmentId) {
      await User.updateMany(
        { role: "student", classId: item._id },
        { $set: { departmentId: item.majorId.departmentId._id } },
      );
    }
    const students = await User.find({
      role: "student",
      status: "active",
      classId: item._id,
    }).select("_id");
    const teacher = item.homeroomTeacherId
      ? await User.findOne({
          _id: item.homeroomTeacherId,
          role: "lecturer",
          status: "active",
        }).select("_id")
      : null;
    // Thành viên gồm sinh viên đang hoạt động trong lớp và giảng viên chủ nhiệm hợp lệ.
    const userIds = [...students.map((student) => student._id), ...(teacher ? [teacher._id] : [])];
    for (const userId of userIds) {
      await ChannelMember.updateOne(
        { channelId: channel._id, userId },
        { $setOnInsert: { channelId: channel._id, userId, joinedAt: new Date() } },
        { upsert: true },
      );
    }
    // Gỡ người đã chuyển lớp, đổi phân công hoặc bị khóa khỏi danh sách thành viên.
    await ChannelMember.deleteMany({ channelId: channel._id, userId: { $nin: userIds } });
  }
  classEvents.emit("changed");
}
function syncClasses() {
  // Tuần tự để hai thao tác admin không ghi đè danh sách thành viên của nhau.
  syncQueue = syncQueue.catch(() => {}).then(synchronizeClasses);
  return syncQueue;
}
module.exports = {
  getActiveClass,
  getActiveMajor,
  isClassActive,
  resolveUserMembership,
  syncClasses,
  classEvents,
};
