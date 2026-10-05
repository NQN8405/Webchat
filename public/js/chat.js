const history = document.querySelector(".message-history");
if (history) history.scrollTop = history.scrollHeight;
document.getElementById("message-content")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (e.target.value.trim()) e.target.form.requestSubmit();
  }
});

if (history && typeof io === "function") {
  const channelId = history.dataset.channelId,
    userId = history.dataset.userId;
  const status = document.getElementById("chat-connection");
  const errorBox = document.getElementById("chat-send-error");
  const form = document.querySelector(".message-composer");
  const input = document.getElementById("message-content");
  const button = form?.querySelector("button[type=submit]");
  const sendButtonHTML = button?.innerHTML;
  const olderButton = document.getElementById("load-older-messages");
  const loadStatus = document.getElementById("history-load-status");
  const olderButtonHTML = olderButton.innerHTML;
  let hasMore = false,
    cursor = null,
    loadingOlder = false,
    connectionVersion = 0;
  let joined = false,
    writable = history.dataset.writable === "true",
    sending = false,
    pending = null,
    denied = false;
  let syncing = false,
    liveEvents = [],
    deleting = false;
  const removedMessages = new Set();
  const socket = io({ auth: { token: history.dataset.token } });
  const setStatus = (message) => {
    status.textContent = message;
  };
  const setError = (message) => {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  };
  function controls() {
    olderButton.hidden = !hasMore;
    olderButton.disabled = !joined || denied || loadingOlder;
    if (button) button.disabled = !joined || !writable || sending;
    if (input) input.disabled = denied || !writable || sending;
    if (form) form.hidden = denied || !writable;
    const closed = document.querySelector(".closed-channel");
    if (closed) closed.hidden = denied || writable;
    const badge = document.querySelector(".chat-topbar .pill");
    if (badge) {
      badge.textContent = writable ? "Đang mở" : "Đã đóng";
      badge.classList.toggle("active", writable);
      badge.classList.toggle("closed", !writable);
    }
    history.querySelectorAll("[data-message-action]").forEach((button) => {
      button.disabled = !joined || !writable || deleting;
    });
  }
  function renderMessage(message, scroll = true) {
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 120;
    if (message.channelId !== channelId || removedMessages.has(message.id)) return;
    const existing = history.querySelector('[data-message-id="' + message.id + '"]');
    if (existing) return;
    const mine = message.sender.id === userId;
    const row = document.createElement("article");
    row.className = "message-row" + (mine ? " mine" : "");
    row.dataset.messageId = message.id;
    row.dataset.createdAt = message.createdAt;
    const element = (tag, cls, text) => {
      const node = document.createElement(tag);
      node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const avatar = element("span", "message-avatar", message.sender.displayName.slice(0, 1));
    avatar.setAttribute("aria-hidden", "true");
    avatar.classList.add("avatar-image");
    if (message.sender.avatarUrl) {
      const img = document.createElement("img");
      img.src = message.sender.avatarUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove());
      avatar.append(img);
    }
    const body = element("div", "message-body"),
      meta = element("div", "message-meta");
    meta.append(element("strong", "", mine ? "Bạn" : message.sender.displayName));
    const time = element(
      "time",
      "",
      new Date(message.createdAt).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    time.dateTime = message.createdAt;
    meta.append(time);
    const bubble = element("div", "message-bubble");
    if (message.content) bubble.append(element("p", "", message.content));
    body.append(meta, bubble);
    if (mine) {
      const actions = element("div", "message-actions");
      const control = element("button", "message-action delete");
      control.type = "button";
      control.dataset.messageAction = "delete";
      const symbol = element("i", "bi bi-trash");
      symbol.setAttribute("aria-hidden", "true");
      control.append(symbol, document.createTextNode(" Xóa"));
      actions.append(control);
      body.append(actions);
    }
    row.append(avatar, body);
    history.querySelector(".conversation-empty")?.remove();
    const rows = [...history.querySelectorAll("[data-message-id]")];
    const key = (r) => r.dataset.createdAt + r.dataset.messageId;
    const next = rows.find((r) => key(r) > key(row));
    history.insertBefore(row, next || null);
    if (scroll && (nearBottom || mine)) history.scrollTop = history.scrollHeight;
    controls();
  }
  controls();
  socket.on("connect", () => {
    connectionVersion++;
    const version = connectionVersion;
    loadingOlder = false;
    olderButton.innerHTML = olderButtonHTML;
    loadStatus.textContent = "";
    joined = false;
    syncing = true;
    liveEvents = [];
    controls();
    setStatus("Đang đồng bộ tin nhắn…");
    socket.timeout(10000).emit("channel:join", { channelId }, (error, result) => {
      if (version !== connectionVersion || denied) return;
      if (error || !result?.ok) {
        setError(result?.message || "Không thể đồng bộ. Hãy tải lại trang.");
        setStatus("Chưa kết nối được kênh");
        return;
      }
      history.querySelectorAll("[data-message-id]").forEach((row) => row.remove());
      removedMessages.clear();
      joined = true;
      writable = result.writable;
      denied = false;
      hasMore = result.hasMore;
      cursor = result.cursor;
      result.messages.forEach((message) => renderMessage(message, false));
      history.scrollTop = history.scrollHeight;
      syncing = false;
      liveEvents.forEach(([event, message]) => receive(event, message));
      liveEvents = [];
      emptyHistory();
      controls();
      setStatus(
        writable ? "Đã kết nối · Tin nhắn cập nhật trực tiếp" : "Kênh đã đóng · Chỉ xem lịch sử",
      );
    });
  });

  olderButton.addEventListener("click", () => {
    if (!joined || denied || loadingOlder || !hasMore || !cursor) return;
    loadingOlder = true;
    controls();
    loadStatus.textContent = "";
    olderButton.textContent = "Đang tải…";
    const version = connectionVersion;
    socket
      .timeout(10000)
      .emit("message:history", { channelId, before: cursor }, (error, result) => {
        if (version !== connectionVersion) return;
        loadingOlder = false;
        olderButton.innerHTML = olderButtonHTML;
        if (error || !result?.ok) {
          controls();
          loadStatus.textContent =
            result?.message || "Không tải được tin nhắn cũ. Bấm tải lại để thử.";
          return;
        }
        const anchor = [...history.querySelectorAll("[data-message-id]")].find(
          (row) => row.getBoundingClientRect().bottom > history.getBoundingClientRect().top,
        );
        const top = anchor?.getBoundingClientRect().top;
        result.messages.forEach((message) => renderMessage(message, false));
        hasMore = result.hasMore;
        cursor = result.cursor;
        controls();
        if (anchor) history.scrollTop += anchor.getBoundingClientRect().top - top;
        loadStatus.textContent = hasMore ? "" : "Đã tải hết tin nhắn.";
      });
  });

  function emptyHistory() {
    if (
      !history.querySelector("[data-message-id]") &&
      !history.querySelector(".conversation-empty")
    ) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty text-center";
      empty.textContent = "Chưa có tin nhắn trong kênh này.";
      history.append(empty);
    }
  }
  function receive(event, message) {
    if (message.channelId !== channelId) return;
    if (syncing) {
      liveEvents.push([event, message]);
      return;
    }
    if (event === "message:deleted") {
      removedMessages.add(message.id);
      history.querySelector('[data-message-id="' + message.id + '"]')?.remove();
      emptyHistory();
    } else renderMessage(message);
  }
  for (const event of ["message:new", "message:deleted"]) {
    socket.on(event, (message) => receive(event, message));
  }
  history.addEventListener("click", (event) => {
    const control = event.target.closest('[data-message-action="delete"]');
    if (!control || control.disabled || !joined || !writable || deleting) return;
    const row = control.closest("[data-message-id]");
    if (!row.classList.contains("mine")) return;
    if (!window.confirm("Xóa tin nhắn này? Tin nhắn sẽ bị xóa khỏi kênh.")) return;
    deleting = true;
    controls();
    setError("");
    socket
      .timeout(10000)
      .emit("message:delete", { channelId, messageId: row.dataset.messageId }, (error, result) => {
        deleting = false;
        controls();
        if (error || !result?.ok) {
          setError(
            result?.message || "Chưa nhận được xác nhận. Kết nối lại để kiểm tra và thử lại.",
          );
          return;
        }
        receive("message:deleted", result.message);
        setStatus("Đã xóa tin nhắn");
      });
  });
  socket.on("disconnect", () => {
    connectionVersion++;
    loadingOlder = false;
    joined = false;
    controls();
    setStatus(denied ? "Không còn quyền truy cập" : "Mất kết nối · Đang kết nối lại…");
  });
  socket.on("connect_error", (error) => {
    joined = false;
    controls();
    setStatus(
      error.data?.code === "UNAUTHORIZED"
        ? "Phiên đăng nhập hết hạn · Hãy đăng nhập lại"
        : "Không thể kết nối · Đang thử lại…",
    );
  });
  socket.on("channel:state", (state) => {
    if (state.channelId !== channelId) return;
    writable = state.writable;
    controls();
    setStatus(
      writable ? "Đã kết nối · Tin nhắn cập nhật trực tiếp" : "Kênh đã đóng · Chỉ xem lịch sử",
    );
  });
  socket.on("channel:unavailable", (result) => {
    denied = true;
    joined = false;
    controls();
    setError(result.message);
    setStatus("Không còn quyền truy cập · Hãy tải lại trang");
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!joined || !writable || sending) {
      setError("Chưa thể gửi. Hãy kiểm tra kết nối và trạng thái kênh.");
      return;
    }
    const content = input.value.trim();
    if (!content || content.length > 4000) {
      setError("Nhập tin nhắn từ 1 đến 4.000 ký tự.");
      return;
    }
    if (!pending || pending.content !== content) {
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      pending = { channelId, content, requestId };
    }
    sending = true;
    controls();
    setError("");
    button.textContent = "Đang gửi…";
    socket.timeout(10000).emit("message:send", pending, (error, result) => {
      sending = false;
      button.innerHTML = sendButtonHTML;
      controls();
      if (error || !result?.ok) {
        setError(result?.message || "Chưa nhận được xác nhận. Kết nối lại rồi bấm Gửi để thử lại.");
        if (result?.code === "CHANNEL_CLOSED") {
          writable = false;
          controls();
        }
        return;
      }
      renderMessage(result.message);
      pending = null;
      input.value = "";
      input.focus();
    });
  });
}
