const bcrypt = require("bcrypt");
const User = require("../models/User");
const Channel = require("../models/Channel");
const ChannelMember = require("../models/ChannelMember");
const { text, birthDate } = require("../services/validation");
const { channelAccess, saveMessage, messagePage } = require("./chatMessages");

const roles = { student: "Sinh viên", lecturer: "Giảng viên", admin: "Quản trị viên" };

async function loadChannels(req) {
  const memberships = await ChannelMember.find({ userId: req.session.user.id }).select("channelId");
  const allChannels = await Channel.find({
    _id: { $in: memberships.map((member) => member.channelId) },
    type: "class",
  })
    .populate({
      path: "classId",
      populate: { path: "majorId", populate: { path: "departmentId" } },
    })
    .sort({ name: 1 });
  const search = text(req.query.search).toLocaleLowerCase("vi");
  const classId = text(req.query.classId);
  const classes = [
    ...new Map(
      allChannels
        .filter((channel) => channel.classId)
        .map((channel) => [String(channel.classId._id), channel.classId]),
    ).values(),
  ];
  const channels = allChannels.filter(
    (channel) =>
      channel.classId &&
      (!classId || String(channel.classId._id) === classId) &&
      (channel.name + " " + channel.classId?.name).toLocaleLowerCase("vi").includes(search),
  );
  return { channels, classes, filters: { search: text(req.query.search), classId } };
}
function renderPage(res, view, data = {}) {
  res.render("user/" + view, {
    roles,
    tab: "chat",
    selected: null,
    writable: false,
    messages: [],
    hasMore: false,
    members: [],
    ...data,
  });
}

exports.getHome = async (req, res) => {
  renderPage(res, "home", await loadChannels(req));
};

exports.getChat = async (req, res) => {
  const data = await loadChannels(req);
  const channelId = text(req.query.channel);
  if (!channelId) return renderPage(res, "home", data);
  const access = await channelAccess(channelId, req.session.user.id);
  const [page, memberships] = await Promise.all([
    messagePage(channelId),
    ChannelMember.find({ channelId }).populate("userId", "displayName avatarUrl role status"),
  ]);
  renderPage(res, "chat", {
    ...data,
    selected: access.channel,
    writable: access.writable,
    messages: page.messages,
    hasMore: page.hasMore,
    members: memberships.filter((member) => member.userId?.status === "active"),
  });
};

exports.getProfile = async (req, res) => {
  const profile = await User.findById(req.session.user.id)
    .populate("departmentId")
    .populate({ path: "classId", populate: { path: "majorId" } });
  const passwordFeedback = req.session.passwordFeedback || null;
  delete req.session.passwordFeedback;
  const profileFeedback = req.session.profileFeedback || null;
  delete req.session.profileFeedback;
  renderPage(res, "profile", { tab: "profile", profile, passwordFeedback, profileFeedback });
};

exports.sendMessage = async (req, res) => {
  const message = await saveMessage(req.params.id, req.session.user.id, req.body.content);
  await req.app.locals
    .publishChatMessage?.(message)
    .catch((error) => console.error("Chat publish:", error.message));
  res.redirect("/chat?channel=" + req.params.id);
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const fail = (message) => {
    req.session.passwordFeedback = { type: "danger", message };
    return res.redirect("/profile");
  };
  if (typeof currentPassword !== "string" || !currentPassword)
    return fail("Hãy nhập mật khẩu hiện tại.");
  if (
    typeof newPassword !== "string" ||
    newPassword.length < 6 ||
    Buffer.byteLength(newPassword) > 72
  )
    return fail("Mật khẩu mới cần ít nhất 6 ký tự và tối đa 72 byte.");
  if (newPassword !== confirmPassword) return fail("Xác nhận mật khẩu mới không khớp.");
  const account = await User.findById(req.session.user.id);
  if (!account || !(await bcrypt.compare(currentPassword, account.hashedPassword)))
    return fail("Mật khẩu hiện tại không đúng.");
  if (currentPassword === newPassword) return fail("Mật khẩu mới phải khác mật khẩu hiện tại.");
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const result = await User.updateOne(
    { _id: account._id, hashedPassword: account.hashedPassword, status: "active" },
    { hashedPassword },
  );
  if (!result.modifiedCount)
    return fail("Thông tin tài khoản đã thay đổi. Hãy tải lại trang và thử lại.");
  req.session.passwordFeedback = { type: "success", message: "Đổi mật khẩu thành công." };
  res.redirect("/profile");
};

exports.updateProfile = async (req, res) => {
  const displayName = text(req.body.displayName);
  const birthDateInput = text(req.body.birthDate);
  const fail = (message) => {
    req.session.profileFeedback = {
      type: "danger",
      message,
      draft: { displayName, birthDate: birthDateInput },
    };
    return res.redirect("/profile");
  };
  if (!displayName || displayName.length > 100) return fail("Tên hiển thị cần từ 1 đến 100 ký tự.");
  let dateOfBirth;
  try {
    dateOfBirth = birthDate(birthDateInput);
  } catch (error) {
    return fail(error.message);
  }
  const account = await User.findOneAndUpdate(
    { _id: req.session.user.id, status: "active" },
    { displayName, birthDate: dateOfBirth },
    { returnDocument: "after", runValidators: true },
  );
  if (!account) return fail("Tài khoản không còn hoạt động.");
  req.session.user.displayName = account.displayName;
  req.session.profileFeedback = {
    type: "success",
    message: "Cập nhật thông tin cá nhân thành công.",
  };
  res.redirect("/profile");
};
