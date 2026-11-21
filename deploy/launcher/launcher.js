const message = document.getElementById("message");
const retry = document.getElementById("retry");
let stopped = false;
window.addEventListener("pagehide", () => { stopped = true; });

async function probe(url, service) {
  try {
    const response = await fetch(url, {
      cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === "ready" && (service !== "frontend" || data.service === "frontend");
  } catch {
    return false;
  }
}

async function start() {
  retry.hidden = true;
  message.textContent = "Đang khởi động. Vui lòng giữ trang này mở.";
  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Missing configuration");
    const config = await response.json();
    // Only the deployed configuration controls targets, never query parameters.
    for (const key of ["frontend", "backend"]) {
      const url = new URL(config[key]);
      if (url.protocol !== "https:" || url.origin !== config[key]) throw new Error("Invalid origin");
      document.getElementById(key).textContent = "Đang khởi động…";
    }
    const deadline = Date.now() + 5 * 60 * 1000;
    while (!stopped && Date.now() < deadline) {
      // Recheck both on every round, including a service that was ready before.
      const ready = await Promise.all([
        probe(`${config.frontend}/api/health`, "frontend"),
        probe(`${config.backend}/health/ready`, "backend"),
      ]);
      if (stopped) return;
      for (const [index, key] of ["frontend", "backend"].entries()) {
        document.getElementById(key).textContent = ready[index] ? "Sẵn sàng ✓" : "Đang chờ…";
      }
      if (ready.every(Boolean)) {
        message.textContent = "Hệ thống sẵn sàng. Đang mở FireGuard…";
        window.location.replace(`${config.frontend}/`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    if (stopped) return;
    message.textContent = "Chưa kết nối được sau 5 phút. Hãy thử lại; nếu vẫn lỗi, liên hệ quản trị viên kiểm tra dịch vụ và cấu hình kết nối.";
  } catch {
    message.textContent = "Không đọc được cấu hình khởi động. Vui lòng liên hệ quản trị viên.";
  }
  retry.hidden = false;
}

retry.addEventListener("click", start);
start();
